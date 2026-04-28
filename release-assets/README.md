# release-assets — 发行包附带文件

这些文件在 `npm run build` 时由 scripts/build.js 自动拷贝到
dist/SilverWolfPet-win32-x64/ 根目录。

## 一次性准备

从 Microsoft 官网下载 VC++ 2015-2022 x64 运行库，重命名为
`vc_redist.x64.exe` 放到本目录：

https://aka.ms/vs/17/release/vc_redist.x64.exe

下载完应该 ~14MB。本目录里 `.gitkeep` 之外的二进制文件都不入 git。
