using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class WinApi {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  public const int SW_HIDE = 0;
  public const int SW_SHOW = 5;
  public const int SW_RESTORE = 9;
  public const int WM_HOTKEY = 0x0312;

  // 按标题包含匹配查找窗口（比 FindWindow 更健壮，容忍标题前缀/后缀差异）
  public static IntPtr FindByTitle(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      StringBuilder t = new StringBuilder(512);
      GetWindowText(h, t, 512);
      string s = t.ToString();
      if (s.Contains(needle)) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        // 取最上层可见的那个
        if (IsWindowVisible(h) || found == IntPtr.Zero) found = h;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}

// 隐藏的消息窗口，用于接收全局热键
public class HotKeyWindow : Form {
  // 公开字段（非 event），便于 PowerShell 直接赋值回调
  public Action HotKeyCallback;
  public HotKeyWindow() {
    this.ShowInTaskbar = false;
    this.FormBorderStyle = FormBorderStyle.FixedToolWindow;
    this.WindowState = FormWindowState.Minimized;
    this.Opacity = 0;
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == WinApi.WM_HOTKEY && m.WParam.ToInt32() == 1) {
      if (HotKeyCallback != null) HotKeyCallback();
    }
    base.WndProc(ref m);
  }
}
