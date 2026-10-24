using System;
using System.Diagnostics;
using System.Drawing;
using System.Collections.Generic;
using System.IO;
using System.Windows.Forms;

namespace CountingDown.Setup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // 安装器崩了没有任何地方能看日志，这里兜底写一份到临时目录
            AppDomain.CurrentDomain.UnhandledException += (s, e) => WriteCrash(e.ExceptionObject as Exception);
            Application.ThreadException += (s, e) => WriteCrash(e.Exception);

            var cli = Cli.Parse(args);

            if (cli.PurgeDir != null)
            {
                // 卸载副本在临时目录里跑：删文件、清注册表，然后把自己也删掉。
                // 注意：直接从安装包跑 --purge（测试/手动清理）时绝不能自删 —— 那会把安装包本身删掉。
                Installer.Purge(cli.PurgeDir, cli.WaitPid);
                if (IsRunningFromTemp()) ScheduleSelfDelete();
                return 0;
            }

            if (cli.Uninstall)
            {
                var target = cli.Dir ?? ReadInstallDir();
                if (string.IsNullOrEmpty(target) || !Directory.Exists(target))
                {
                    // 注册表项没了也能卸：卸载程序本来就在安装目录里
                    target = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                }
                if (string.IsNullOrEmpty(target) || !Directory.Exists(target))
                {
                    MessageBox.Show("没有找到已安装的倒数日。", "倒数日", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 1;
                }
                Installer.RunUninstaller(target);
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (!string.IsNullOrEmpty(cli.Shot))
            {
                RunShot(cli);
                return 0;
            }

            var options = new InstallOptions
            {
                TargetDir = cli.Dir ?? (cli.Test ? Path.Combine(Path.GetTempPath(), "cd-setup-test") : Installer.DefaultTarget()),
                TestMode = cli.Test
            };

            if (cli.Silent)
            {
                try
                {
                    Installer.Install(options, (step, _) => Console.WriteLine(step), Console.WriteLine);
                    return 0;
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error);
                    return 1;
                }
            }

            Application.Run(new SetupWindow(options, cli.Auto));
            return 0;
        }

        /// <summary>
        /// 离屏出图：把窗口画到位图上再保存。
        /// 桌面抓图受遮挡/合成影响经常拿到旧帧，出素材时用这个才靠谱。
        /// </summary>
        private static void RunShot(Cli cli)
        {
            var options = new InstallOptions
            {
                TargetDir = cli.Dir ?? Installer.DefaultTarget(),
                TestMode = true
            };
            var window = new SetupWindow(options, false);
            if (cli.Shot != "bench") window.Show();
            Application.DoEvents();
            if (cli.Shot == "bench")
            {
                RunBench(window);
                return;
            }

            if (cli.Shot == "step1") window.ForceStep(0);
            else if (cli.Shot == "step2") window.ForceStep(1);
            else if (cli.Shot == "step3") window.ForceStep(2);
            else if (cli.Shot == "installing") window.ForceInstalling();
            else if (cli.Shot == "done") window.ForceDone();
            Application.DoEvents();
            System.Threading.Thread.Sleep(400);
            Application.DoEvents();
            using (var bitmap = new Bitmap(window.Width, window.Height))
            {
                window.DrawToBitmap(bitmap, new Rectangle(0, 0, window.Width, window.Height));
                var path = Path.Combine(Path.GetTempPath(), "cd-shot-" + cli.Shot + ".png");
                bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                Console.WriteLine(path);
            }
            window.Dispose();
        }

        /// <summary>
        /// 翻页动画的帧率自检。
        /// 必须跑真正的 Application.Run 消息循环：Anim 挂在 Application.Idle 上，
        /// 手动 DoEvents 不会触发 Idle，测出来永远是 0 帧。
        /// </summary>
        private static void RunBench(SetupWindow window)
        {
            var slides = 0;
            var timer = new Timer { Interval = 700 };

            timer.Tick += (s, e) =>
            {
                slides++;
                if (slides <= 2)
                {
                    window.NextForBench();
                    return;
                }

                timer.Stop();
                window.BenchStop();
                var deltas = new List<double>();
                foreach (var d in window.FrameDeltas)
                {
                    if (d < 100) deltas.Add(d);
                }
                if (deltas.Count < 3)
                {
                    Console.WriteLine("bench: too few frames (" + deltas.Count + ")");
                }
                else
                {
                    double total = 0;
                    foreach (var d in deltas) total += d;
                    var sorted = new List<double>(deltas);
                    sorted.Sort();
                    int index = (int)Math.Floor(sorted.Count * 0.95) - 1;
                    if (index < 0) index = 0;
                    Console.WriteLine(string.Format(
                        "bench frames={0} avg={1:0.0}ms ({2:0.0}fps) p95={3:0.0}ms max={4:0.0}ms",
                        deltas.Count, total / deltas.Count, 1000.0 / (total / deltas.Count),
                        sorted[index], sorted[sorted.Count - 1]));
                }
                window.Close();
            };

            window.Shown += (s, e) =>
            {
                window.BenchStart();
                timer.Start();
            };

            Application.Run(window);
        }

        private static bool IsRunningFromTemp()
        {
            var self = System.Reflection.Assembly.GetExecutingAssembly().Location;
            var temp = Path.GetTempPath();
            return self.StartsWith(temp, StringComparison.OrdinalIgnoreCase);
        }

        private static void WriteCrash(Exception error)
        {
            try
            {
                var path = Path.Combine(Path.GetTempPath(), "cd-setup-error.log");
                File.AppendAllText(
                    path,
                    DateTime.Now.ToString("s") + " " + error + Environment.NewLine + Environment.NewLine);
            }
            catch
            {
                // 日志都写不了就真没辙了
            }
        }

        private static string ReadInstallDir()
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CountingDown"))
            {
                return key?.GetValue("InstallLocation") as string;
            }
        }

        /// <summary>临时 exe 自己删不掉，交给 cmd 延时处理</summary>
        private static void ScheduleSelfDelete()
        {
            var path = System.Reflection.Assembly.GetExecutingAssembly().Location;
            var info = new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul & del /f /q \"" + path + "\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            };
            Process.Start(info);
        }
    }

    internal class Cli
    {
        public bool Uninstall;
        public bool Test;
        public bool Silent;
        public bool Auto;
        public string Dir;
        public string PurgeDir;
        public string Shot;
        public int WaitPid;

        public static Cli Parse(string[] args)
        {
            var cli = new Cli();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--uninstall": cli.Uninstall = true; break;
                    case "--test": cli.Test = true; break;
                    case "--silent": cli.Silent = true; break;
                    case "--auto": cli.Auto = true; break;
                    case "--dir":
                        if (i + 1 < args.Length) cli.Dir = args[++i];
                        break;
                    case "--shot":
                        if (i + 1 < args.Length) cli.Shot = args[++i];
                        break;
                    case "--purge":
                        if (i + 1 < args.Length) cli.PurgeDir = args[++i];
                        break;
                    case "--wait":
                        if (i + 1 < args.Length) int.TryParse(args[++i], out cli.WaitPid);
                        break;
                }
            }
            return cli;
        }
    }
}
