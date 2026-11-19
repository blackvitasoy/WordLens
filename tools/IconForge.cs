using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class IconForge
{
    static void SavePng(Bitmap b, string path)
    {
        using (var ms = new MemoryStream())
        {
            b.Save(ms, ImageFormat.Png);
            File.WriteAllBytes(path, ms.ToArray());
        }
    }

    public static string Build(string src, string outDir, string pubDir)
    {
        if (!Directory.Exists(outDir)) Directory.CreateDirectory(outDir);
        if (!Directory.Exists(pubDir)) Directory.CreateDirectory(pubDir);

        using (var orig = new Bitmap(src))
        using (var bmp = new Bitmap(1024, 1024, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(orig, 0, 0, 1024, 1024);
            }

            // Rounded-rectangle alpha mask: removes white corners and the AI watermark.
            const int W = 1024;
            const double R = 220.0;
            var rect = new Rectangle(0, 0, W, W);
            var bd = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            byte[] px = new byte[bd.Stride * W];
            Marshal.Copy(bd.Scan0, px, 0, px.Length);
            for (int y = 0; y < W; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    double cov = 1.0;
                    double cx = 0, cy = 0;
                    bool corner = false;
                    if (x < R && y < R) { cx = R; cy = R; corner = true; }
                    else if (x >= W - R && y < R) { cx = W - R; cy = R; corner = true; }
                    else if (x < R && y >= W - R) { cx = R; cy = W - R; corner = true; }
                    else if (x >= W - R && y >= W - R) { cx = W - R; cy = W - R; corner = true; }
                    if (corner)
                    {
                        double dx = x - cx, dy = y - cy;
                        double d = Math.Sqrt(dx * dx + dy * dy);
                        cov = R + 0.5 - d;
                        if (cov < 0) cov = 0;
                        if (cov > 1) cov = 1;
                    }
                    int i = y * bd.Stride + x * 4;
                    px[i + 3] = (byte)(px[i + 3] * cov);
                }
            }

            // Erase the tiny AI watermark in the bottom-right corner with a
            // local median filter: thin bright strokes disappear, gradient stays intact.
            byte[] srcPx = (byte[])px.Clone();
            int startX = W - 145, startY = W - 100;
            int[] vals = new int[121];
            for (int y = startY; y < W; y++)
            {
                for (int x = startX; x < W; x++)
                {
                    int i = y * bd.Stride + x * 4;
                    if (px[i + 3] == 0) continue;
                    for (int c = 0; c < 3; c++)
                    {
                        int n = 0;
                        for (int dy = -10; dy <= 10; dy += 2)
                            for (int dx = -10; dx <= 10; dx += 2)
                            {
                                int xx = x + dx, yy = y + dy;
                                if (xx < 0 || xx >= W || yy < 0 || yy >= W) continue;
                                int k = yy * bd.Stride + xx * 4;
                                if (srcPx[k + 3] == 0) continue;
                                vals[n++] = srcPx[k + c];
                            }
                        if (n == 0) continue;
                        Array.Sort(vals, 0, n);
                        px[i + c] = (byte)vals[n / 2];
                    }
                }
            }

            Marshal.Copy(px, 0, bd.Scan0, px.Length);
            bmp.UnlockBits(bd);

            SavePng(bmp, Path.Combine(outDir, "wordlens-master.png"));
            SavePng(bmp, Path.Combine(pubDir, "app-icon.png"));

            int[] sizes = { 512, 256, 192, 128, 64, 48, 32, 16 };
            var smallBitmaps = new Dictionary<int, Bitmap>();
            foreach (int s in sizes)
            {
                var small = new Bitmap(s, s, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(small))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    g.Clear(Color.Transparent);
                    g.DrawImage(bmp, 0, 0, s, s);
                }
                SavePng(small, Path.Combine(pubDir, "icon-" + s + ".png"));
                smallBitmaps[s] = small;
            }

            // Classic DIB-based ICO (max compatibility with System.Drawing.Icon / NotifyIcon).
            int[] icoSizes = { 256, 128, 64, 48, 32, 16 };
            var dibs = new List<byte[]>();
            foreach (int s in icoSizes) dibs.Add(BuildDib(smallBitmaps[s], s));

            string icoPath = Path.Combine(pubDir, "app.ico");
            using (var fs = new FileStream(icoPath, FileMode.Create))
            using (var w = new BinaryWriter(fs))
            {
                w.Write((short)0);
                w.Write((short)1);
                w.Write((short)icoSizes.Length);
                int offset = 6 + 16 * icoSizes.Length;
                for (int k = 0; k < icoSizes.Length; k++)
                {
                    int s = icoSizes[k];
                    w.Write((byte)(s == 256 ? 0 : s));
                    w.Write((byte)(s == 256 ? 0 : s));
                    w.Write((byte)0);
                    w.Write((byte)0);
                    w.Write((short)1);
                    w.Write((short)32);
                    w.Write(dibs[k].Length);
                    w.Write(offset);
                    offset += dibs[k].Length;
                }
                foreach (var d in dibs) w.Write(d);
            }

            foreach (var kv in smallBitmaps) kv.Value.Dispose();
            return icoPath;
        }
    }

    static byte[] BuildDib(Bitmap b, int s)
    {
        var rect = new Rectangle(0, 0, s, s);
        var bd = b.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] px = new byte[bd.Stride * s];
        Marshal.Copy(bd.Scan0, px, 0, px.Length);
        b.UnlockBits(bd);

        int maskRow = ((s + 31) / 32) * 4;
        int xorSize = s * s * 4;
        byte[] dib = new byte[40 + xorSize + maskRow * s];
        using (var ms = new MemoryStream(dib))
        using (var w = new BinaryWriter(ms))
        {
            w.Write(40);
            w.Write(s);
            w.Write(s * 2);
            w.Write((short)1);
            w.Write((short)32);
            w.Write(0);
            w.Write(xorSize + maskRow * s);
            w.Write(0); w.Write(0); w.Write(0); w.Write(0);
            for (int y = s - 1; y >= 0; y--)
                w.Write(px, y * bd.Stride, s * 4);
            w.Write(new byte[maskRow * s]);
        }
        return dib;
    }
}
