Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
    public struct RECT { public int l, t, r, b; }
    public static string GetAll() {
        var res = new List<string>();
        EnumWindows((h, p) => {
            if (!IsWindowVisible(h) || IsIconic(h)) return true;
            var sb = new StringBuilder(64);
            GetWindowText(h, sb, 64);
            if (sb.Length == 0) return true;
            RECT rc;
            GetWindowRect(h, out rc);
            int w = rc.r - rc.l, ht = rc.b - rc.t;
            if (w < 80 || ht < 40) return true;
            res.Add(rc.l + "," + rc.t + "," + rc.r + "," + rc.b);
            return true;
        }, IntPtr.Zero);
        return string.Join("|", res);
    }
}
"@
[WinEnum]::GetAll()
