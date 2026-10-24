// 打自写安装器：installer/ → cd-setup.exe + payload.zip → 单个 exe → latest.yml
//
// 产物和 electron-builder 的 NSIS 安装包同名（CountingDown_Setup_x.y.z.exe），
// 在线更新那边不用改一行代码。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const unpacked = path.join(root, 'release/win-unpacked')
const installerDir = path.join(root, 'installer')
const payloadZip = path.join(root, '.verify/payload.zip')
const outExe = path.join(root, `release/CountingDown_Setup_${version}.exe`)

function step(text) {
  console.log('• ' + text)
}

if (!fs.existsSync(unpacked)) {
  console.error('缺少 release/win-unpacked，先跑 electron-builder --dir')
  process.exit(1)
}

// 1) 把版本号写进 C#（安装界面和卸载信息都要用）
const buildInfo = path.join(installerDir, 'BuildInfo.cs')
const cs = `namespace CountingDown.Setup
{
    /// <summary>构建时由 scripts/build-installer.cjs 改写。</summary>
    internal static class BuildInfo
    {
        public const string Version = "${version}";
        public const string AppName = "倒数日";
    }
}
`
fs.writeFileSync(buildInfo, cs)
step(`版本写入 BuildInfo.cs → ${version}`)

// 2) 编译安装器
execFileSync('dotnet', ['build', '-c', 'Release', '--nologo', '-v', 'quiet'], {
  cwd: installerDir,
  stdio: 'inherit'
})
const setupExe = path.join(installerDir, 'bin/Release/net48/cd-setup.exe')
if (!fs.existsSync(setupExe)) {
  console.error('编译产物不存在：' + setupExe)
  process.exit(1)
}
step(`编译完成 ${(fs.statSync(setupExe).size / 1024).toFixed(0)} KB`)

// 3) 把 win-unpacked 打成 zip。
//    必须用系统自带的 bsdtar（C:\Windows\System32\tar.exe）：Git Bash 里那个是 GNU tar，
//    会把 "H:\..." 当成「远程主机 H」，直接报 cannot connect。
const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
const tarBin = fs.existsSync(systemTar) ? systemTar : 'tar'
fs.mkdirSync(path.dirname(payloadZip), { recursive: true })
if (fs.existsSync(payloadZip)) fs.rmSync(payloadZip)
step('压缩 win-unpacked…')
execFileSync(tarBin, ['-a', '-c', '-f', payloadZip, '-C', unpacked, '.'], { stdio: 'inherit' })
const zipSize = fs.statSync(payloadZip).size
step(`payload.zip ${(zipSize / 1024 / 1024).toFixed(1)} MB`)

// 4) exe + zip + (int64 长度, magic)，安装器自己从尾部读
const magic = Buffer.from('CDSETUP1', 'ascii')
const length = Buffer.alloc(8)
length.writeBigInt64LE(BigInt(zipSize), 0)
const exeBytes = fs.readFileSync(setupExe)
fs.writeFileSync(outExe, Buffer.concat([exeBytes, fs.readFileSync(payloadZip), length, magic]))
const finalSize = fs.statSync(outExe).size
step(`安装包 ${(finalSize / 1024 / 1024).toFixed(1)} MB → ${path.relative(root, outExe)}`)

// 5) latest.yml：在线更新按这个格式读
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(outExe)).digest('base64')
const latest = `version: ${version}
files:
  - url: ${path.basename(outExe)}
    sha512: ${sha512}
    size: ${finalSize}
path: ${path.basename(outExe)}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`
fs.writeFileSync(path.join(root, 'release/latest.yml'), latest)
step('latest.yml 已更新')
