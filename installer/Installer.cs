using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace CountingDown.Setup
{
    internal class InstallOptions
    {
        public string TargetDir;
        public bool DesktopShortcut = true;
        public bool StartMenuShortcut = true;
        public bool StartAtLogin;
        /// <summary>测试模式：不写快捷方式、不写注册表，只解包</summary>
        public bool TestMode;
    }

    internal static class Installer
    {
        private const string Magic = "CDSETUP1";
        private const string AppExe = "CountingDown.exe";
        private const string UninstallExe = "Uninstall.exe";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CountingDown";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        /// <summary>默认装到当前用户的 Programs 目录，不需要管理员权限</summary>
        public static string DefaultTarget()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "CountingDown");
        }

        public static void Install(InstallOptions options, Action<string, double> report, Action<string> log)
        {
            string target = options.TargetDir;

            report("准备安装目录", 0.02);
            Directory.CreateDirectory(target);

            KillRunning(target);

            string zip = ExtractPayloadToTemp(log);
            try
            {
                Unpack(zip, target, report, log);
            }
            finally
            {
                TryDelete(zip);
            }

            if (options.TestMode)
            {
                log("测试模式：跳过快捷方式与注册表");
                report("安装完成", 1);
                return;
            }

            report("写入快捷方式", 0.94);
            if (options.DesktopShortcut) CreateShortcut(target, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
            if (options.StartMenuShortcut) CreateStartMenuShortcut(target);

            report("登记卸载信息", 0.96);
            CopySelf(Path.Combine(target, UninstallExe));
            WriteUninstallKey(target, options.StartAtLogin);
            WriteStartAtLogin(target, options.StartAtLogin);

            report("安装完成", 1);
        }

        /// <summary>旧版本正在跑的时候覆盖文件会失败，先请它退出</summary>
        private static void KillRunning(string target)
        {
            foreach (var process in Process.GetProcessesByName("CountingDown"))
            {
                try
                {
                    if (string.Equals(process.MainModule?.FileName, Path.Combine(target, AppExe), StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch
                {
                    // 拿不到主模块路径就跳过，让它自己决定
                }
            }
            Thread.Sleep(150);
        }

        /// <summary>
        /// 安装包把自己和 zip 拼在一起：exe + zip + (长度, magic)。
        /// 这里把 zip 段单独落到临时文件，ZipArchive 就能按普通文件打开。
        /// </summary>
        private static string ExtractPayloadToTemp(Action<string> log)
        {
            string self = Assembly.GetExecutingAssembly().Location;
            string temp = Path.Combine(Path.GetTempPath(), "cd-payload-" + Guid.NewGuid().ToString("N") + ".zip");

            using (var source = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long end = source.Length;
                if (end < 16) throw new InvalidOperationException("安装包不完整");
                source.Seek(end - 8, SeekOrigin.Begin);
                var magic = new byte[8];
                source.Read(magic, 0, 8);
                if (Encoding.ASCII.GetString(magic) != Magic)
                    throw new InvalidOperationException("安装包格式不正确（缺少数据段）");

                source.Seek(end - 16, SeekOrigin.Begin);
                var lengthBytes = new byte[8];
                source.Read(lengthBytes, 0, 8);
                long length = BitConverter.ToInt64(lengthBytes, 0);
                if (length <= 0 || length > end - 16) throw new InvalidOperationException("安装包数据段长度异常");

                long start = end - 16 - length;
                source.Seek(start, SeekOrigin.Begin);

                log(string.Format("解包数据段 {0:0.0} MB", length / 1024.0 / 1024.0));
                using (var dest = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    var buffer = new byte[1024 * 256];
                    long left = length;
                    while (left > 0)
                    {
                        int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
                        if (read <= 0) break;
                        dest.Write(buffer, 0, read);
                        left -= read;
                    }
                }
            }
            return temp;
        }

        private static void Unpack(string zipPath, string target, Action<string, double> report, Action<string> log)
        {
            using (var archive = ZipFile.OpenRead(zipPath))
            {
                int total = archive.Entries.Count;
                int index = 0;
                long bytes = 0;
                var root = Path.GetFullPath(target + Path.DirectorySeparatorChar);

                foreach (var entry in archive.Entries)
                {
                    index++;
                    var destination = Path.GetFullPath(Path.Combine(root, entry.FullName));
                    // 防御 zip-slip：条目路径不允许跑到目标目录外面
                    if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;

                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(destination);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        try
                        {
                            entry.ExtractToFile(destination, true);
                            bytes += entry.Length;
                        }
                        catch (IOException)
                        {
                            // 个别文件被杀软占用时重试一次
                            Thread.Sleep(120);
                            entry.ExtractToFile(destination, true);
                        }
                    }

                    if (index % 25 == 0 || index == total)
                    {
                        report(
                            string.Format("解压 {0} / {1}", index, total),
                            0.05 + 0.87 * index / Math.Max(1, total));
                    }
                }
                log(string.Format("共 {0} 个文件，{1:0.0} MB", total, bytes / 1024.0 / 1024.0));
            }
        }

        private static void CreateShortcut(string target, string folder)
        {
            if (string.IsNullOrEmpty(folder)) return;
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, "倒数日.lnk");
            WriteLink(path, Path.Combine(target, AppExe), target, Path.Combine(target, AppExe));
        }

        /// <summary>开始菜单不套文件夹，直接放在 Programs 根下</summary>
        private static void CreateStartMenuShortcut(string target)
        {
            var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            CreateShortcut(target, programs);
        }

        private static void WriteLink(string linkPath, string targetPath, string workingDir, string iconPath)
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            var shell = Activator.CreateInstance(shellType);
            try
            {
                dynamic link = shellType.InvokeMember(
                    "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
                link.TargetPath = targetPath;
                link.WorkingDirectory = workingDir;
                link.IconLocation = iconPath + ",0";
                link.Description = "倒数日 —— 桌面倒计时小组件";
                link.Save();
            }
            finally
            {
                if (shell != null && System.Runtime.InteropServices.Marshal.IsComObject(shell))
                    System.Runtime.InteropServices.Marshal.ReleaseComObject(shell);
            }
        }

        private static void CopySelf(string destination)
        {
            string self = Assembly.GetExecutingAssembly().Location;
            if (string.Equals(self, destination, StringComparison.OrdinalIgnoreCase)) return;
            File.Copy(self, destination, true);
        }

        private static void WriteUninstallKey(string target, bool startAtLogin)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                if (key == null) return;
                long sizeKb = 0;
                try
                {
                    foreach (var file in Directory.GetFiles(target, "*", SearchOption.AllDirectories))
                    {
                        sizeKb += new FileInfo(file).Length / 1024;
                    }
                }
                catch
                {
                    // 统计失败不影响卸载入口
                }

                key.SetValue("DisplayName", "倒数日");
                key.SetValue("DisplayVersion", BuildInfo.Version);
                key.SetValue("Publisher", "CountingDown");
                key.SetValue("DisplayIcon", Path.Combine(target, AppExe) + ",0");
                key.SetValue("InstallLocation", target);
                key.SetValue("UninstallString", "\"" + Path.Combine(target, UninstallExe) + "\"");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                if (sizeKb > 0) key.SetValue("EstimatedSize", (int)sizeKb, RegistryValueKind.DWord);
            }
        }

        private static void WriteStartAtLogin(string target, bool enabled)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (key == null) return;
                if (enabled)
                    key.SetValue("CountingDown", "\"" + Path.Combine(target, AppExe) + "\" --hidden");
                else if (key.GetValue("CountingDown") != null)
                    key.DeleteValue("CountingDown", false);
            }
        }

        public static void Launch(string target, bool hidden)
        {
            var exe = Path.Combine(target, AppExe);
            if (!File.Exists(exe)) return;
            var info = new ProcessStartInfo(exe);
            if (hidden) info.Arguments = "--hidden";
            info.WorkingDirectory = target;
            Process.Start(info);
        }

        public static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // 临时文件删不掉就让系统清
            }
        }

        /// <summary>卸载：把自己复制到临时目录，再让副本去删目标目录</summary>
        public static void RunUninstaller(string target)
        {
            string self = Assembly.GetExecutingAssembly().Location;
            string temp = Path.Combine(Path.GetTempPath(), "cd-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(self, temp, true);

            var info = new ProcessStartInfo(temp);
            info.Arguments = "--purge \"" + target + "\" --wait " + Process.GetCurrentProcess().Id;
            // UseShellExecute=true：让副本独立启动，别继承父进程的控制台句柄
            // （否则从命令行/脚本调用时，父进程退出后控制台还被这个子进程占着）
            info.UseShellExecute = true;
            Process.Start(info);
        }

        public static void Purge(string target, int waitPid)
        {
            try
            {
                if (waitPid > 0)
                {
                    var other = Process.GetProcessById(waitPid);
                    other.WaitForExit(8000);
                }
            }
            catch
            {
                // 已经退出
            }

            foreach (var process in Process.GetProcessesByName("CountingDown"))
            {
                try { process.Kill(); process.WaitForExit(2000); }
                catch { }
            }
            Thread.Sleep(300);

            try { DeleteIfExists(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "倒数日.lnk"); } catch { }
            try { DeleteIfExists(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "倒数日.lnk"); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key != null && key.GetValue("CountingDown") != null) key.DeleteValue("CountingDown", false);
                }
            }
            catch { }

            DeleteTree(target);
        }

        /// <summary>
        /// 删目录时不能整个 Directory.Delete(root, true) 一把梭：
        /// 刚写进去的大文件经常还被杀毒或系统占用，一次失败就整套中止，
        /// 结果剩下半个目录。这里逐个删、失败就重试，最后再收目录。
        /// </summary>
        private static void DeleteTree(string root)
        {
            // 进程的工作目录如果在待删目录里，Windows 会拒绝删除它
            try { Directory.SetCurrentDirectory(Path.GetTempPath()); } catch { }

            string lastError = null;
            for (int attempt = 0; attempt < 24; attempt++)
            {
                if (!Directory.Exists(root)) return;

                // 快路径：一次递归删掉
                try
                {
                    Directory.Delete(root, true);
                    if (!Directory.Exists(root)) return;
                }
                catch (Exception error)
                {
                    lastError = "tree: " + error.GetType().Name + " " + error.Message;
                }

                try
                {
                    foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                    {
                        try
                        {
                            File.SetAttributes(file, FileAttributes.Normal);
                            File.Delete(file);
                        }
                        catch (Exception error)
                        {
                            lastError = Path.GetFileName(file) + ": " + error.GetType().Name + " " + error.Message;
                        }
                    }

                    var dirs = Directory.GetDirectories(root, "*", SearchOption.AllDirectories);
                    Array.Sort(dirs, (a, b) => b.Length.CompareTo(a.Length));
                    foreach (var dir in dirs)
                    {
                        try { Directory.Delete(dir, false); }
                        catch (Exception error)
                        {
                            lastError = "dir " + Path.GetFileName(dir) + ": " + error.Message;
                        }
                    }

                    Directory.Delete(root, false);
                    if (!Directory.Exists(root)) return;
                }
                catch (Exception error)
                {
                    lastError = "root: " + error.Message;
                }

                Thread.Sleep(500);
            }

            WriteLog("purge 未能删净 " + root + " → " + (lastError ?? "unknown"));

            // 目录已经空了但删不掉（Windows 会把「删除挂起」的句柄留在目录上），
            // 交给系统在下次重启时收尸，别在「应用和功能」里留个空壳。
            try
            {
                if (Directory.Exists(root) && Directory.GetFileSystemEntries(root).Length == 0)
                {
                    MoveFileEx(root, null, MOVEFILE_DELAY_UNTIL_REBOOT);
                    WriteLog("已排入重启后删除 " + root);
                }
            }
            catch
            {
                // 排不进就算了
            }
        }

        private const int MOVEFILE_DELAY_UNTIL_REBOOT = 4;

        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);

        private static void WriteLog(string line)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(Path.GetTempPath(), "cd-setup.log"),
                    DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
            }
            catch
            {
                // 日志写不了就算了
            }
        }

        private static void DeleteIfExists(string folder, string name)
        {
            var path = Path.Combine(folder, name);
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
