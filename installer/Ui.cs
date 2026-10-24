using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CountingDown.Setup
{
    /// <summary>整套配色。跟应用里的深色主题同源（#10142A / #3A7AFF / #5C42E0）。</summary>
    internal static class Palette
    {
        public static readonly Color Bg = ColorTranslator.FromHtml("#0E1124");
        public static readonly Color BgRaised = ColorTranslator.FromHtml("#151A33");
        public static readonly Color Stroke = ColorTranslator.FromHtml("#232A4A");
        public static readonly Color StrokeSoft = ColorTranslator.FromHtml("#1B2140");
        public static readonly Color Text = ColorTranslator.FromHtml("#EDF0FA");
        public static readonly Color TextDim = ColorTranslator.FromHtml("#A7B0CC");
        public static readonly Color TextFaint = ColorTranslator.FromHtml("#6F7899");
        public static readonly Color Accent = ColorTranslator.FromHtml("#3A7AFF");
        public static readonly Color Accent2 = ColorTranslator.FromHtml("#7C5CFF");
        public static readonly Color Danger = ColorTranslator.FromHtml("#E5484D");
        public static readonly Color InputBg = ColorTranslator.FromHtml("#0B0E1E");
    }

    /// <summary>把两个颜色按 t 插值（0=from，1=to）</summary>
    internal static class Mix
    {
        public static Color Between(Color from, Color to, double t)
        {
            double k = Math.Max(0, Math.Min(1, t));
            return Color.FromArgb(
                (int)Math.Round(from.A + (to.A - from.A) * k),
                (int)Math.Round(from.R + (to.R - from.R) * k),
                (int)Math.Round(from.G + (to.G - from.G) * k),
                (int)Math.Round(from.B + (to.B - from.B) * k));
        }
    }

    /// <summary>画圆角矩形的一次性工具。</summary>
    internal static class Draw
    {
        public static GraphicsPath Round(RectangleF rect, float radius)
        {
            var path = new GraphicsPath();
            float d = radius * 2;
            if (d <= 0)
            {
                path.AddRectangle(rect);
                return path;
            }
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, RectangleF rect, float radius, Color color)
        {
            using (var path = Round(rect, radius))
            using (var brush = new SolidBrush(color))
            {
                g.FillPath(brush, path);
            }
        }

        public static void StrokeRound(Graphics g, RectangleF rect, float radius, Color color, float width = 1f)
        {
            using (var path = Round(rect, radius))
            using (var pen = new Pen(color, width))
            {
                g.DrawPath(pen, path);
            }
        }
    }

    /// <summary>
    /// 自绘按钮。原生 Button 在深色窗体上是浅灰一块，且改不了圆角 ——
    /// 整个安装器要「看起来像应用的一部分」，控件就得自己画。
    /// </summary>
    internal class FlatButton : Control
    {
        private double _hoverT;
        private bool _down;

        public bool Primary { get; set; }
        public bool UseGradient { get; set; }

        public FlatButton()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw,
                true);
            Cursor = Cursors.Hand;
            Font = new Font("Microsoft YaHei UI", 9.5f);
            Height = 34;
        }

        protected override void OnMouseEnter(EventArgs e) { FadeTo(1); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _down = false; FadeTo(0); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { _down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { _down = false; Invalidate(); base.OnMouseUp(e); }

        /// <summary>悬停渐变：120ms 从当前值过渡到目标值，鼠标扫过去是跟手的</summary>
        private void FadeTo(double target)
        {
            double from = _hoverT;
            Anim.Run(120, Anim.OutCubic, t =>
            {
                _hoverT = from + (target - from) * t;
                Invalidate();
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            // 父容器是自绘的，这里必须自己刷底色，否则会残留上一帧
            g.Clear(Parent != null ? Parent.BackColor : Palette.Bg);

            var rect = new RectangleF(0, 0, Width - 1, Height - 1);
            Color textColor;

            if (Primary)
            {
                var from = _down ? Palette.Accent2 : Palette.Accent;
                var to = _down ? Palette.Accent : Palette.Accent2;
                using (var path = Draw.Round(rect, 8))
                using (var brush = new LinearGradientBrush(rect, from, to, 20f))
                {
                    g.FillPath(brush, path);
                }
                int overlay = (int)Math.Round(28 * _hoverT);
                if (overlay > 0)
                {
                    using (var path = Draw.Round(rect, 8))
                    using (var brush = new SolidBrush(Color.FromArgb(overlay, 255, 255, 255)))
                    {
                        g.FillPath(brush, path);
                    }
                }
                textColor = Color.White;
            }
            else
            {
                if (_hoverT > 0.01)
                {
                    Draw.FillRound(g, rect, 8, Color.FromArgb((int)Math.Round(255 * _hoverT), Palette.BgRaised));
                }
                var border = Mix.Between(Palette.Stroke, ColorTranslator.FromHtml("#3A4370"), _hoverT);
                Draw.StrokeRound(g, rect, 8, border);
                textColor = Mix.Between(Palette.TextDim, Palette.Text, _hoverT);
            }

            TextRenderer.DrawText(
                g, Text, Font, Rectangle.Round(rect), textColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    /// <summary>标题栏上的极小图标按钮（最小化 / 关闭）。</summary>
    internal class CaptionButton : Control
    {
        private double _hoverT;
        public bool IsClose { get; set; }

        public CaptionButton()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw,
                true);
            Size = new Size(34, 30);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { FadeTo(1); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { FadeTo(0); base.OnMouseLeave(e); }

        private void FadeTo(double target)
        {
            double from = _hoverT;
            Anim.Run(120, Anim.OutCubic, t =>
            {
                _hoverT = from + (target - from) * t;
                Invalidate();
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Palette.Bg);

            if (_hoverT > 0.01)
            {
                var bg = IsClose ? Palette.Danger : ColorTranslator.FromHtml("#252B4A");
                Draw.FillRound(
                    g, new RectangleF(2, 2, Width - 4, Height - 4), 6,
                    Color.FromArgb((int)Math.Round(255 * _hoverT), bg));
            }

            var color = Mix.Between(Palette.TextDim, IsClose ? Color.White : Palette.Text, _hoverT);
            using (var pen = new Pen(color, 1.4f))
            {
                float cx = Width / 2f, cy = Height / 2f;
                if (IsClose)
                {
                    g.DrawLine(pen, cx - 4, cy - 4, cx + 4, cy + 4);
                    g.DrawLine(pen, cx + 4, cy - 4, cx - 4, cy + 4);
                }
                else
                {
                    g.DrawLine(pen, cx - 5, cy + 3, cx + 5, cy + 3);
                }
            }
        }
    }

    /// <summary>自绘勾选行：整行可点，方块 + 文字一套深色皮肤。</summary>
    internal class CheckRow : Control
    {
        private bool _hover;
        private bool _checked;

        public bool Checked
        {
            get { return _checked; }
            set { _checked = value; Invalidate(); }
        }

        public string Hint { get; set; }

        public CheckRow()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw,
                true);
            Height = 26;
            Cursor = Cursors.Hand;
            Font = new Font("Microsoft YaHei UI", 9.5f);
        }

        protected override void OnClick(EventArgs e)
        {
            _checked = !_checked;
            Invalidate();
            base.OnClick(e);
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            g.Clear(Parent != null ? Parent.BackColor : Palette.Bg);

            var box = new RectangleF(0, (Height - 16) / 2f, 16, 16);
            if (_checked)
            {
                using (var path = Draw.Round(box, 4))
                using (var brush = new LinearGradientBrush(box, Palette.Accent, Palette.Accent2, 30f))
                {
                    g.FillPath(brush, path);
                }
                using (var pen = new Pen(Color.White, 1.9f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLines(pen, new[]
                    {
                        new PointF(box.X + 4.2f, box.Y + 8.2f),
                        new PointF(box.X + 6.9f, box.Y + 11f),
                        new PointF(box.X + 11.8f, box.Y + 5.2f)
                    });
                }
            }
            else
            {
                Draw.FillRound(g, box, 4, Palette.InputBg);
                Draw.StrokeRound(g, box, 4, _hover ? ColorTranslator.FromHtml("#4A5588") : Palette.Stroke);
            }

            TextRenderer.DrawText(
                g, Text, Font,
                new Rectangle(22, 0, Width - 22, Height), Palette.TextDim,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    /// <summary>细进度条：圆角轨道 + 渐变填充。</summary>
    internal class ThinProgress : Control
    {
        private double _value;

        public double Value
        {
            get { return _value; }
            set
            {
                _value = Math.Max(0, Math.Min(1, value));
                Invalidate();
            }
        }

        public ThinProgress()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw,
                true);
            Height = 8;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Palette.Bg);

            var track = new RectangleF(0, 0, Width, Height);
            Draw.FillRound(g, track, Height / 2f, ColorTranslator.FromHtml("#1B2140"));

            float w = (float)(Width * _value);
            if (w < 4) return;
            var fill = new RectangleF(0, 0, Math.Max(w, Height), Height);
            using (var path = Draw.Round(track, Height / 2f))
            using (var brush = new LinearGradientBrush(track, Palette.Accent, Palette.Accent2, 0f))
            {
                var old = g.Clip;
                g.SetClip(path);
                g.FillRectangle(brush, fill);
                g.Clip = old;
            }
        }
    }
}
