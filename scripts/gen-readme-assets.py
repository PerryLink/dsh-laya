#!/usr/bin/env python3
"""Generate bespoke README art for dsh-laya.

Outputs (idempotent overwrite):
  docs/assets/dsh-laya-hero-{zh,en}-{light,dark}.webp   1440x576
  docs/assets/dsh-laya-flow-v5-{light,dark}.svg         1100x660

The hero is a raster "local decision instrument": an evidence batch enters one
loopback sidecar, and the output is shown as the three typed readouts Laya can
actually produce (noul probability + band, a chosen label, an ordered scale
position). The flow diagram is a two-channel boundary drawing, not a chain:
budget preflight runs above without a forward pass, the typed ask path runs
below through one forward pass, and the sidecar's three exits fan out to the
right. Both are drawn from the public surface in index.js / plan.js / sidecar.js
and from the measured example documented in README.md.

Run:  <bundled-python> scripts/gen-readme-assets.py
Needs: Pillow with a CJK font (msyh.ttc) and Consolas (consola.ttf).
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --------------------------------------------------------------------------- #
# canvas / palette
# --------------------------------------------------------------------------- #
SS = 2                    # render at 2x and downsample once
W, HERO_H = 1440, 576

FONT_REG_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_MONO_CANDIDATES = [
    r"C:\Windows\Fonts\consola.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]


def pick_font(paths):
    for path in paths:
        if os.path.exists(path):
            return path
    return None


FONT_REG = pick_font(FONT_REG_CANDIDATES)
FONT_BOLD = pick_font(FONT_BOLD_CANDIDATES)
FONT_MONO = pick_font(FONT_MONO_CANDIDATES)
if not FONT_REG or not FONT_BOLD or not FONT_MONO:
    sys.exit("FATAL: a required font is missing (need CJK regular/bold and a mono).")

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def fnt(kind: str, size: float) -> ImageFont.FreeTypeFont:
    key = (kind, int(round(size * SS)))
    if key not in _FONT_CACHE:
        path = {"reg": FONT_REG, "bold": FONT_BOLD, "mono": FONT_MONO}[kind]
        _FONT_CACHE[key] = ImageFont.truetype(path, int(round(size * SS)))
    return _FONT_CACHE[key]


def rgb(value: str, alpha: int = 255):
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def mix(a: str, b: str, t: float) -> tuple[int, int, int]:
    ca, cb = rgb(a), rgb(b)
    return tuple(int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))


def sc(v: float) -> int:
    return int(round(v * SS))


def tw(text: str, font: ImageFont.FreeTypeFont) -> float:
    return font.getlength(text) / SS


def text(draw, x, y, value, font, fill, anchor="ls", stroke=0):
    draw.text(
        (sc(x), sc(y)),
        value,
        font=font,
        fill=fill,
        anchor=anchor,
        stroke_width=sc(stroke) if stroke else 0,
        stroke_fill=fill,
    )


def runs(draw, x, y, parts, default_fill):
    """Draw same-baseline runs: (text, font, fill_or_None)."""
    cursor = x
    for value, font, fill in parts:
        text(draw, cursor, y, value, font, default_fill if fill is None else fill)
        cursor += tw(value, font)
    return cursor


def shadow_rect(img, x, y, w, h, radius, alpha, blur, dy, color=(26, 20, 52)):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle(
        [sc(x), sc(y + dy), sc(x + w), sc(y + h + dy)],
        radius=sc(radius),
        fill=(*color, alpha),
    )
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(sc(blur))))


def card(img, draw, x, y, w, h, radius, fill, border, *, alpha=34, blur=14, dy=8,
         border_w=1.5, color=(26, 20, 52)):
    shadow_rect(img, x, y, w, h, radius, alpha, blur, dy, color)
    draw.rounded_rectangle(
        [sc(x), sc(y), sc(x + w), sc(y + h)],
        radius=sc(radius),
        fill=fill,
        outline=border,
        width=sc(border_w),
    )


def pill(draw, x, y, w, h, label, font, fg, bg, border=None, pad=0):
    draw.rounded_rectangle(
        [sc(x), sc(y), sc(x + w), sc(y + h)],
        radius=sc(h / 2),
        fill=bg,
        outline=border if border else None,
        width=sc(1) if border else 0,
    )
    text(draw, x + w / 2, y + h / 2 + 0.5, label, font, fg, anchor="mm")


def arrow(draw, x1, y1, x2, y2, color, width=2.0, head=7.0):
    draw.line([(sc(x1), sc(y1)), (sc(x2), sc(y2))], fill=color, width=sc(width))
    angle = math.atan2(y2 - y1, x2 - x1)
    a1, a2 = angle + math.radians(150), angle - math.radians(150)
    pts = [
        (sc(x2), sc(y2)),
        (sc(x2 + head * math.cos(a1)), sc(y2 + head * math.sin(a1))),
        (sc(x2 + head * math.cos(a2)), sc(y2 + head * math.sin(a2))),
    ]
    draw.polygon(pts, fill=color)


def dashed(draw, x1, y1, x2, y2, color, width=1.2, dash=7, gap=6):
    length = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    at = 0.0
    while at < length:
        end = min(at + dash, length)
        draw.line(
            [(sc(x1 + ux * at), sc(y1 + uy * at)),
             (sc(x1 + ux * end), sc(y1 + uy * end))],
            fill=color,
            width=sc(width),
        )
        at += dash + gap


PALETTE = {
    "light": dict(
        bg_top="#f9f6fd", bg_bottom="#e4eaf8",
        ink="#171a26", body="#4d5466", muted="#7c8497",
        accent="#4B67B4", accent_deep="#354a91", accent_tint="#e9edfa",
        choice="#6f65b9", score="#2d827b",
        card="#ffffff", card_soft="#f8f9fe", border="#dcd9ec", line="#e8e5f1",
        green="#2c8a62", green_tint="#e7f4ed", amber="#a66a1f",
        panel="#ffffff", panel_border="#d9d6e9",
        dot="#4B67B4", shadow=(26, 20, 52), shadow_alpha=26,
        engine="#1c2740", engine_text="#f4f7ff", engine_muted="#b7c4e3",
    ),
    "dark": dict(
        bg_top="#131a2a", bg_bottom="#0c1016",
        ink="#f4f6fc", body="#b7c0d5", muted="#8590a8",
        accent="#8496f5", accent_deep="#aab7ff", accent_tint="#202b48",
        choice="#a79af0", score="#61c2b5",
        card="#182235", card_soft="#1a263b", border="#2b3750", line="#243047",
        green="#62d4a1", green_tint="#15352f", amber="#dfb168",
        panel="#141e30", panel_border="#2b3750",
        dot="#8496f5", shadow=(0, 0, 0), shadow_alpha=150,
        engine="#24314e", engine_text="#f5f7ff", engine_muted="#c1cbe6",
    ),
}


def background(skin: str) -> Image.Image:
    s = PALETTE[skin]
    img = Image.new("RGBA", (W * SS, HERO_H * SS), rgb(s["bg_top"]))
    draw = ImageDraw.Draw(img)
    for y in range(HERO_H * SS):
        t = y / max(1, HERO_H * SS - 1)
        draw.line([(0, y), (W * SS, y)], fill=mix(s["bg_top"], s["bg_bottom"], t))
    # soft local glows
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    if skin == "light":
        ld.ellipse([sc(1030), sc(-160), sc(1600), sc(430)],
                   fill=rgb("#d7e1ff", 120))
        ld.ellipse([sc(-160), sc(300), sc(600), sc(760)],
                   fill=rgb("#efe4ff", 105))
    else:
        ld.ellipse([sc(1040), sc(-180), sc(1630), sc(460)],
                   fill=rgb("#27375f", 160))
        ld.ellipse([sc(-160), sc(300), sc(620), sc(780)],
                   fill=rgb("#2a1f47", 145))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(sc(78))))
    # dotted texture on the graphic side
    dots = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    alpha = 19 if skin == "light" else 25
    for x in range(742, W, 30):
        for y in range(34, HERO_H, 30):
            r = 1.15
            dd.ellipse([sc(x - r), sc(y - r), sc(x + r), sc(y + r)],
                       fill=rgb(s["dot"], alpha))
    img.alpha_composite(dots)
    # one large quiet arc behind the instrument
    arc = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc)
    ad.arc([sc(960), sc(-220), sc(1540), sc(360)], 106, 356,
           fill=rgb(s["accent"], 33), width=sc(1.4))
    ad.arc([sc(1005), sc(-175), sc(1495), sc(315)], 120, 340,
           fill=rgb(s["accent"], 22), width=sc(1.2))
    img.alpha_composite(arc)
    return img


COPY = {
    "zh": dict(
        brand="DSH 插件", tail="  /  本地决策模型",
        title=["有类型的判断。", "模型在本机。"],
        value1="三种判断，一次本机前向传播；",
        value2=("答案回 Host，", "state 不出这台机器。"),
        sub1=("noul / choice / score，接成 Cordis 服务 ", "ctx.laya", "；"),
        sub2="外加 laya_ask、laya_plan 两个模型可见工具。",
        meta=["ctx.laya", "laya_ask", "laya_plan"],
        route="POST /ask · /plan",
        footer="Apache-2.0 · PerryLink DSH plugin family",
    ),
    "en": dict(
        brand="DSH PLUGIN", tail="  /  LOCAL DECISION MODEL",
        title=["Typed decisions.", "Model, local."],
        value1="Three decision types, one local forward pass;",
        value2=("answers back to the host, ", "state stays local."),
        sub1=("noul / choice / score, as the Cordis service ", "ctx.laya", ","),
        sub2="plus tools laya_ask / laya_plan. No prose.",
        meta=["ctx.laya", "laya_ask", "laya_plan"],
        route="POST /ask · /plan",
        footer="Apache-2.0 · PerryLink DSH plugin family",
    ),
}


def draw_mark(draw, s):
    x, y = 92, 54
    draw.rounded_rectangle([sc(x), sc(y), sc(x + 26), sc(y + 26)],
                           radius=sc(8), fill=rgb(s["accent"]))
    pts = [(x + 8, y + 9), (x + 18, y + 9), (x + 13, y + 18)]
    for i, (px, py) in enumerate(pts):
        r = 2.1 if i == 2 else 1.8
        draw.ellipse([sc(px - r), sc(py - r), sc(px + r), sc(py + r)],
                     fill=(255, 255, 255, 235))
    draw.line([(sc(x + 8), sc(y + 9)), (sc(x + 18), sc(y + 9)), (sc(x + 13), sc(y + 18))],
              fill=(255, 255, 255, 130), width=sc(0.9), joint="curve")


def noul_band(draw, x, y, w, h, s, font14, skin):
    """Schematic no / uncertain / yes band with the documented 0.5457 marker."""
    draw.rounded_rectangle([sc(x), sc(y), sc(x + w), sc(y + h)],
                           radius=sc(h / 2), fill=rgb("#eef0f8" if skin == "light" else "#263046"))
    cuts = [0.0, 0.35, 0.65, 1.0]
    fills = ["#e6e2f1" if skin == "light" else "#302b4b",
             "#dfe6fb" if skin == "light" else "#29395e",
             "#e0f1e9" if skin == "light" else "#1d3b37"]
    for i in range(3):
        x1 = x + w * cuts[i] + (2 if i else 0)
        x2 = x + w * cuts[i + 1] - (2 if i < 2 else 0)
        r = min(h / 2, 4)
        draw.rounded_rectangle([sc(x1), sc(y), sc(x2), sc(y + h)],
                               radius=sc(r), fill=rgb(fills[i]))
    mx = x + w * 0.5457
    my = y + h / 2
    draw.ellipse([sc(mx - 9), sc(my - 9), sc(mx + 9), sc(my + 9)],
                 fill=rgb(s["card"]))
    draw.ellipse([sc(mx - 5), sc(my - 5), sc(mx + 5), sc(my + 5)],
                 fill=rgb(s["accent"]))
    # labels sit under the band
    lx = [x + w * 0.175, x + w * 0.5, x + w * 0.825]
    for label, xx, color in (
        ("no", lx[0], s["muted"]),
        ("uncertain", lx[1], s["accent"]),
        ("yes", lx[2], s["muted"]),
    ):
        text(draw, xx, y + h + 20, label, font14, rgb(color), anchor="ms")


def hero(lang: str, skin: str) -> Image.Image:
    s = PALETTE[skin]
    c = COPY[lang]
    img = background(skin)
    draw = ImageDraw.Draw(img)

    # ---- left column ------------------------------------------------------
    draw_mark(draw, s)
    k_brand = fnt("bold", 20)
    k_tail = fnt("reg", 20)
    runs(
        draw, 128, 78,
        [(c["brand"], k_brand, rgb(s["accent"])),
         (c["tail"], k_tail, rgb(s["muted"]))],
        rgb(s["muted"]),
    )

    title_size = 90 if lang == "zh" else 80
    title_font = fnt("bold", title_size)
    for size in range(title_size, title_size - 10, -1):
        f = fnt("bold", size)
        if max(tw(t, f) for t in c["title"]) <= 680:
            title_font = f
            break
    text(draw, 92, 184, c["title"][0], title_font, rgb(s["ink"]))
    text(draw, 92, 280, c["title"][1], title_font, rgb(s["ink"]))

    value_font = fnt("reg", 28)
    text(draw, 92, 340, c["value1"], value_font, rgb(s["body"]))
    prefix, rest = c["value2"]
    runs(
        draw, 92, 376,
        [(prefix, value_font, rgb(s["body"])),
         (rest, value_font, rgb(s["accent"]))],
        rgb(s["body"]),
    )

    sub_font = fnt("reg", 25)
    a, b, cc = c["sub1"]
    runs(
        draw, 92, 424,
        [(a, sub_font, rgb(s["muted"])), (b, sub_font, rgb(s["accent"])),
         (cc, sub_font, rgb(s["muted"]))],
        rgb(s["muted"]),
    )
    text(draw, 92, 456, c["sub2"], sub_font, rgb(s["muted"]))

    # meta chips + route
    meta_font = fnt("mono", 20)
    x = 92
    for label in c["meta"]:
        width = tw(label, meta_font) + 26
        draw.rounded_rectangle([sc(x), sc(480), sc(x + width), sc(514)],
                               radius=sc(10), fill=rgb(s["accent_tint"]),
                               outline=rgb(s["accent"], 55), width=sc(1))
        text(draw, x + width / 2, 497.4, label, meta_font, rgb(s["accent"]), anchor="mm")
        x += width + 10
    route_x = x + 14
    text(draw, route_x, 504, c["route"], meta_font, rgb(s["muted"]))

    # left footer
    draw.line([(sc(92), sc(528)), (sc(720), sc(528))], fill=rgb(s["line"]), width=sc(1))
    foot_font = fnt("reg", 18)
    text(draw, 92, 552, c["footer"], foot_font, rgb(s["muted"]))
    ver_font = fnt("mono", 17)
    text(draw, 720, 551, "v0.1.8", ver_font, rgb(s["muted"]), anchor="rs")

    # ---- right instrument -------------------------------------------------
    px, py, pw, ph = 788, 40, 572, 492
    card(img, draw, px, py, pw, ph, 22, rgb(s["panel"], 245), rgb(s["panel_border"]),
         alpha=s["shadow_alpha"] + 16, blur=26, dy=14, border_w=1.4,
         color=s["shadow"])
    draw = ImageDraw.Draw(img)

    # header
    dot = (822, 72)
    draw.ellipse([sc(dot[0] - 5), sc(dot[1] - 5), sc(dot[0] + 5), sc(dot[1] + 5)],
                 fill=rgb(s["green"]))
    engine_font = fnt("bold", 21)
    text(draw, 836, 80, "laya-mcp serve", engine_font, rgb(s["ink"]))
    end_font = fnt("mono", 17)
    ep = "127.0.0.1:8787"
    epw = tw(ep, end_font) + 28
    draw.rounded_rectangle([sc(1332 - epw), sc(54), sc(1332), sc(88)],
                           radius=sc(12), fill=rgb(s["accent_tint"]),
                           outline=rgb(s["accent"], 50), width=sc(1))
    text(draw, 1332 - epw / 2, 71, ep, end_font, rgb(s["accent"]), anchor="mm")
    sub_font_16 = fnt("reg", 17)
    text(draw, 836, 112, "loopback sidecar · Python / PyTorch", sub_font_16, rgb(s["muted"]))
    text(draw, 1332, 112, "this machine", sub_font_16, rgb(s["green"]), anchor="rs")
    draw.line([(sc(816), sc(124)), (sc(1332), sc(124))], fill=rgb(s["line"]), width=sc(1))

    # input rail
    draw.rounded_rectangle([sc(816), sc(132), sc(1332), sc(174)],
                           radius=sc(14), fill=rgb(s["card_soft"]),
                           outline=rgb(s["border"]), width=sc(1))
    rail_font = fnt("mono", 18)
    text(draw, 832, 159, "state + questions", rail_font, rgb(s["body"]))
    arrow(draw, 1018, 153, 1042, 153, rgb(s["accent"]), width=1.7, head=5.5)
    text(draw, 1054, 159, "POST /ask", rail_font, rgb(s["accent"]))
    draw.ellipse([sc(1155), sc(151), sc(1161), sc(157)], fill=rgb(s["muted"]))
    text(draw, 1316, 159, "1 forward pass", rail_font, rgb(s["body"]), anchor="rs")

    # typed readout 1: noul
    card(img, draw, 816, 186, 516, 112, 18, rgb(s["card"]), rgb(s["border"]),
         alpha=s["shadow_alpha"] - 4, blur=10, dy=5, border_w=1.2, color=s["shadow"])
    draw = ImageDraw.Draw(img)
    mono19 = fnt("mono", 19)
    text(draw, 836, 210, "noul", mono19, rgb(s["accent"]))
    note_font = fnt("reg", 14)
    text(draw, 1312, 210, "P(true) · calibrated", note_font, rgb(s["muted"]), anchor="rs")
    big_font = fnt("bold", 50)
    text(draw, 836, 276, "0.5457", big_font, rgb(s["ink"]))
    noul_band(draw, 1022, 238, 290, 13, s, note_font, skin)

    # typed readout 2: choice
    card(img, draw, 816, 306, 516, 84, 18, rgb(s["card"]), rgb(s["border"]),
         alpha=s["shadow_alpha"] - 4, blur=10, dy=5, border_w=1.2, color=s["shadow"])
    draw = ImageDraw.Draw(img)
    text(draw, 836, 332, "choice", mono19, rgb(s["choice"]))
    text(draw, 1312, 332, "one of your labels", note_font, rgb(s["muted"]), anchor="rs")
    pill_font = fnt("mono", 16)
    selected_fg = "#ffffff" if skin == "light" else "#151b2a"
    pill(draw, 836, 342, 94, 32, "refund", pill_font, rgb(selected_fg), rgb(s["choice"]))
    pill(draw, 942, 342, 88, 32, "cancel", pill_font, rgb(s["body"]), rgb(s["card_soft"]),
         border=rgb(s["border"]))
    pill(draw, 1042, 342, 78, 32, "other", pill_font, rgb(s["body"]), rgb(s["card_soft"]),
         border=rgb(s["border"]))
    text(draw, 1312, 362, "1 chosen", note_font, rgb(s["muted"]), anchor="rs")

    # typed readout 3: score
    card(img, draw, 816, 398, 516, 84, 18, rgb(s["card"]), rgb(s["border"]),
         alpha=s["shadow_alpha"] - 4, blur=10, dy=5, border_w=1.2, color=s["shadow"])
    draw = ImageDraw.Draw(img)
    text(draw, 836, 422, "score", mono19, rgb(s["score"]))
    text(draw, 1312, 422, "your ascending scale", note_font, rgb(s["muted"]), anchor="rs")
    text(draw, 1194, 439, "4.00", fnt("mono", 16), rgb(s["score"]), anchor="ms")
    track_y = 450
    draw.rounded_rectangle([sc(836), sc(track_y - 2), sc(1312), sc(track_y + 2)],
                           radius=sc(2), fill=rgb(s["line"]))
    draw.rounded_rectangle([sc(836), sc(track_y - 2), sc(1194), sc(track_y + 2)],
                           radius=sc(2), fill=rgb(s["score"], 205))
    for i, xx in enumerate([836, 955, 1074, 1193, 1312]):
        draw.ellipse([sc(xx - 4), sc(track_y - 4), sc(xx + 4), sc(track_y + 4)],
                     fill=rgb(s["score"]))
        text(draw, xx, 472, str(i + 1), fnt("mono", 14),
             rgb(s["muted"]), anchor="ms")
    draw.ellipse([sc(1194 - 8), sc(track_y - 8), sc(1194 + 8), sc(track_y + 8)],
                 fill=rgb(s["card"]))
    draw.ellipse([sc(1194 - 5), sc(track_y - 5), sc(1194 + 5), sc(track_y + 5)],
                 fill=rgb(s["score"]))

    # instrument footer
    draw.line([(sc(816), sc(500)), (sc(1332), sc(500))], fill=rgb(s["line"]), width=sc(1))
    draw.ellipse([sc(818), sc(509), sc(828), sc(519)], fill=rgb(s["green"]))
    status_font = fnt("bold", 16)
    text(draw, 838, 518, "state STAYS LOCAL", status_font, rgb(s["green"]))
    foot_right = fnt("reg", 15)
    text(draw, 1312, 518, "typed answers return to the host", foot_right, rgb(s["muted"]), anchor="rs")

    return img.resize((W, HERO_H), Image.Resampling.LANCZOS).convert("RGB")


# --------------------------------------------------------------------------- #
# flow SVG
# --------------------------------------------------------------------------- #
def flow_svg(skin: str) -> str:
    if skin == "light":
        bg1, bg2 = "#f9f6fd", "#e4eaf8"
        ink, body, muted = "#171a28", "#4b5265", "#7d8497"
        border, line = "#ddd8ec", "#e9e5f2"
        card_fill, soft = "#ffffff", "#f7f8fd"
        accent, accent_deep = "#4B67B4", "#35498c"
        accent_tint = "#e9edfa"
        choice, score = "#6F65B9", "#2D827B"
        green, green_tint = "#2C8A62", "#e6f4ed"
        amber, amber_tint = "#A66A1F", "#fbf2e2"
        engine, engine_text, engine_muted = "#1b2740", "#f4f7ff", "#bcc8e5"
        shadow_color, shadow_op = "#1b1735", "0.13"
        glow = "#4B67B4"
    else:
        bg1, bg2 = "#131a2a", "#0c1016"
        ink, body, muted = "#f4f6fc", "#b7c0d5", "#8590a8"
        border, line = "#2b3750", "#243047"
        card_fill, soft = "#182235", "#1a263b"
        accent, accent_deep = "#8496f5", "#aab7ff"
        accent_tint = "#202b48"
        choice, score = "#a79af0", "#61c2b5"
        green, green_tint = "#62d4a1", "#15352f"
        amber, amber_tint = "#dfb168", "#332b1b"
        engine, engine_text, engine_muted = "#24314e", "#f5f7ff", "#c1cbe6"
        shadow_color, shadow_op = "#000000", "0.42"
        glow = "#8496f5"

    def esc(s):
        return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    def T(x, y, value, size, fill, *, mono=False, weight=400, anchor="start",
          spacing=None, opacity=None):
        fam = ("'Consolas','SFMono-Regular','Menlo',ui-monospace,monospace"
               if mono else
               "'Segoe UI','Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif")
        extra = f' letter-spacing="{spacing}"' if spacing is not None else ""
        op = f' opacity="{opacity}"' if opacity is not None else ""
        return (f'<text x="{x}" y="{y}" fill="{fill}" font-family="{fam}" '
                f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"'
                f'{extra}{op}>{esc(value)}</text>')

    def rect(x, y, w, h, r, fill, stroke=None, sw=1.3, extra=""):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
                f'fill="{fill}"{st}{extra}/>')

    def pill(x, y, w, h, label, size, fill, fg, *, mono=True, stroke=None, weight=700):
        parts = [
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" '
            f'fill="{fill}"' + (f' stroke="{stroke}" stroke-width="1"' if stroke else "") + '/>',
            T(x + w / 2, y + h / 2 + 4.7, label, size, fg, mono=mono,
              weight=weight, anchor="middle"),
        ]
        return parts

    def panel(x, y, w, h, r, fill, stroke):
        return (f'<g filter="url(#soft)">' + rect(x, y, w, h, r, fill, stroke) + '</g>')

    def card(x, y, w, h, r, fill, stroke, sw=1.3):
        return rect(x, y, w, h, r, fill, stroke, sw)

    out = []
    out.append(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
        'viewBox="0 0 1100 660" role="img" aria-labelledby="fig-title fig-desc">'
    )
    out.append(
        '<title id="fig-title">dsh-laya: two routes cross one loopback boundary</title>'
    )
    out.append(
        '<desc id="fig-desc">The host registers laya_plan and laya_ask. '
        'laya_plan sends POST /plan across the loopback boundary to the Python sidecar and comes '
        'back with budget arithmetic that runs no forward pass. laya_ask sends POST /ask to the '
        'same sidecar, spends one forward pass, and fans out into three typed exits: noul returns '
        'a calibrated probability with a no/uncertain/yes band, choice returns one named label, '
        'score returns a position on an ascending scale. Answers, truncation data and warnings '
        'return to the host; state stays on this machine by default at 127.0.0.1:8787. A '
        'non-loopback sidecarUrl is allowed but warns once and changes the startup line to LEAVES '
        'THIS MACHINE. plan_questions() is the shared arithmetic behind both /plan and /ask.</desc>'
    )
    out.append('<defs>')
    out.append(
        f'<linearGradient id="bg" x1="0" y1="0" x2="0.38" y2="1">'
        f'<stop offset="0" stop-color="{bg1}"/><stop offset="1" stop-color="{bg2}"/>'
        f'</linearGradient>'
    )
    out.append(
        f'<filter id="soft" x="-30%" y="-30%" width="170%" height="190%">'
        f'<feDropShadow dx="0" dy="7" stdDeviation="10" flood-color="{shadow_color}" '
        f'flood-opacity="{shadow_op}"/></filter>'
    )
    out.append(
        f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" '
        f'markerHeight="6.5" orient="auto-start-reverse">'
        f'<path d="M0 0 L10 5 L0 10 z" fill="{accent}"/></marker>'
    )
    out.append(
        f'<marker id="arrg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" '
        f'markerHeight="6.5" orient="auto-start-reverse">'
        f'<path d="M0 0 L10 5 L0 10 z" fill="{green}"/></marker>'
    )
    out.append('</defs>')

    # backdrop
    out.append(rect(0, 0, 1100, 660, 22, 'url(#bg)'))
    out.append(f'<circle cx="1010" cy="115" r="260" fill="{glow}" opacity="0.045"/>')
    out.append(f'<circle cx="105" cy="610" r="245" fill="{choice}" opacity="0.035"/>')

    # header
    out.append(T(44, 50, 'dsh-laya · decisions at the loopback boundary', 27, ink, weight=700))
    out.append(T(44, 80,
                 'Two surfaces, two routes, one boundary: budget preflight above; one forward pass below; three typed exits.',
                 16, body))
    out.append(T(1056, 50, 'v0.1.8 · DSH plugin', 14, muted, mono=True, anchor='end'))
    out.append(f'<line x1="44" y1="100" x2="1056" y2="100" stroke="{line}" stroke-width="1.4"/>')

    # host panel
    out.append(panel(44, 116, 442, 444, 22, card_fill, border))
    out.append(T(66, 145, 'HOST · DeepSeek Harness', 18, ink, weight=700))
    out.append(T(464, 145, 'ctx.laya', 14, accent, mono=True, weight=700, anchor='end'))
    out.append(T(66, 168, 'two tool registrations · one HTTP client', 14, muted))
    out.append(f'<line x1="64" y1="182" x2="466" y2="182" stroke="{line}" stroke-width="1.2"/>')

    # host: plan card
    out.append(card(64, 198, 402, 112, 18, soft, border))
    out.append(T(84, 228, 'laya_plan', 20, ink, mono=True, weight=700))
    out.extend(pill(306, 210, 140, 26, 'no forward pass', 14, accent_tint, accent, mono=False))
    out.append(T(84, 254, 'budget preflight · POST /plan', 15, body))
    out.append(T(84, 278, 'same batch and arithmetic as /ask', 15, muted))

    # host: ask card
    out.append(card(64, 338, 402, 142, 18, soft, border))
    out.append(T(84, 368, 'laya_ask', 20, ink, mono=True, weight=700))
    out.extend(pill(320, 350, 126, 26, '1 forward pass', 14, accent_tint, accent, mono=False))
    out.append(T(84, 394, 'typed batch · POST /ask', 15, body))
    for bx, bw, label, col in (
        (84, 66, 'noul', accent),
        (160, 78, 'choice', choice),
        (248, 68, 'score', score),
    ):
        out.append(rect(bx, 406, bw, 28, 9, accent_tint, border, 1))
        out.append(T(bx + bw / 2, 424.5, label, 14, col, mono=True, weight=700, anchor='middle'))
    out.append(T(84, 458, 'strict:true turns truncation into a refusal', 14, muted))

    # host: service rail
    out.append(rect(64, 496, 402, 48, 14, accent_tint, None, 0))
    out.append(T(82, 518, 'ctx.laya.ask / ctx.laya.plan', 14, accent, mono=True, weight=700))
    out.append(T(82, 537, 'the service surface uses the same two routes', 14, muted))

    # boundary
    out.append(f'<line x1="550" y1="128" x2="550" y2="546" stroke="{accent}" '
               f'stroke-width="1.4" stroke-dasharray="6 7" opacity="0.55"/>')
    out.append(T(550, 146, 'LOOPBACK', 14, accent, mono=True, weight=700,
                 anchor='middle', spacing=1.4))
    out.append(T(550, 168, '127.0.0.1:8787', 14, body, mono=True, weight=700,
                 anchor='middle'))
    out.extend(pill(522, 240, 56, 28, '/plan', 15, accent_tint, accent, stroke=border))
    out.extend(pill(527, 395, 46, 28, '/ask', 15, accent_tint, accent, stroke=border))
    out.extend(pill(494, 510, 112, 28, 'STAYS LOCAL', 14, green_tint, green,
                    mono=True, weight=700, stroke=green))

    # lane lines, plan
    out.append(f'<line x1="466" y1="254" x2="519" y2="254" stroke="{accent}" '
               f'stroke-width="1.8" stroke-linecap="round" marker-end="url(#arr)"/>')
    out.append(f'<line x1="578" y1="254" x2="632" y2="254" stroke="{accent}" '
               f'stroke-width="1.8" stroke-linecap="round" marker-end="url(#arr)"/>')
    # lane lines, ask
    out.append(f'<line x1="466" y1="409" x2="524" y2="409" stroke="{accent}" '
               f'stroke-width="1.8" stroke-linecap="round" marker-end="url(#arr)"/>')
    out.append(f'<line x1="573" y1="409" x2="632" y2="409" stroke="{accent}" '
               f'stroke-width="1.8" stroke-linecap="round" marker-end="url(#arr)"/>')

    # sidecar panel
    out.append(panel(614, 116, 442, 444, 22, card_fill, border))
    out.append(T(636, 145, 'SIDECAR', 18, ink, weight=700))
    out.append(T(738, 145, 'Python / PyTorch', 14, muted))
    out.append(T(1034, 145, 'laya-mcp serve', 14, accent, mono=True, weight=700, anchor='end'))
    out.append(T(636, 168, 'weights live here; the plugin only speaks HTTP', 14, muted))
    out.append(f'<line x1="636" y1="182" x2="1034" y2="182" stroke="{line}" stroke-width="1.2"/>')

    # sidecar: plan result
    out.append(card(636, 198, 398, 104, 18, soft, border))
    out.append(T(656, 226, 'budget arithmetic', 18, ink, weight=700))
    out.extend(pill(916, 208, 100, 26, 'fits: true', 14, green_tint, green, mono=True, stroke=green))
    out.append(T(656, 248, 'POST /plan · no forward pass', 14, muted))
    # compact capacity bar
    out.append(rect(656, 266, 360, 9, 4.5, line))
    out.append(rect(656, 266, 150, 9, 4.5, accent, None, 0, ' opacity="0.55"'))
    out.append(rect(809, 266, 92, 9, 4.5, green, None, 0, ' opacity="0.65"'))
    out.append(rect(904, 266, 112, 9, 4.5, border, None, 0, ' opacity="0.75"'))
    out.append(T(656, 290, 'state ~ estimate', 14, muted, mono=True))
    out.append(T(809, 290, 'options exact', 14, muted, mono=True))
    out.append(T(1016, 290, 'headroom', 14, muted, mono=True, anchor='end'))

    # sidecar: ask engine
    out.append(card(636, 334, 150, 150, 18, engine, accent, sw=1.4))
    out.append(T(652, 358, 'POST /ask', 14, engine_muted, mono=True, weight=700))
    out.append(f'<circle cx="711" cy="398" r="24" fill="{accent}" opacity="0.16"/>')
    out.append(f'<circle cx="711" cy="398" r="24" fill="none" stroke="{accent}" stroke-width="1.8"/>')
    out.append(T(711, 407, '1×', 26, engine_text, mono=True, weight=700, anchor='middle'))
    out.append(T(711, 442, 'forward pass', 14, engine_text, mono=False, anchor='middle'))
    out.append(T(711, 462, 'sidecar serialises', 14, engine_muted, anchor='middle'))

    # sidecar: typed outputs + fan-out bus
    out.append(f'<path d="M786 409 H796 V347 H808" fill="none" stroke="{accent}" '
               f'stroke-width="1.7" stroke-linecap="round" marker-end="url(#arr)"/>')
    out.append(f'<line x1="796" y1="409" x2="808" y2="409" stroke="{accent}" '
               f'stroke-width="1.7" marker-end="url(#arr)"/>')
    out.append(f'<path d="M796 409 V471 H808" fill="none" stroke="{accent}" '
               f'stroke-width="1.7" stroke-linecap="round" marker-end="url(#arr)"/>')

    outputs = [
        (320, 'noul', accent, 342),
        (382, 'choice', choice, 413),
        (444, 'score', score, 475),
    ]
    for oy, label, col, label_y in outputs:
        out.append(card(812, oy, 222, 54, 18, card_fill, border))
        out.append(f'<rect x="812" y="{oy}" width="3.5" height="54" rx="1.75" fill="{col}"/>')
        out.append(T(828, label_y, label, 18, col, mono=True, weight=700))

    # noul detail
    out.append(T(890, 342, '0.5457', 17, ink, mono=True, weight=700))
    out.append(f'<rect x="890" y="352" width="128" height="7" rx="3.5" fill="{line}"/>')
    out.append(f'<rect x="890" y="352" width="42" height="7" rx="3.5" fill="{muted}" opacity="0.45"/>')
    out.append(f'<rect x="934" y="352" width="42" height="7" rx="3.5" fill="{accent}" opacity="0.55"/>')
    out.append(f'<rect x="978" y="352" width="40" height="7" rx="3.5" fill="{green}" opacity="0.45"/>')
    mx = 890 + 128 * 0.5457
    out.append(f'<circle cx="{mx:.1f}" cy="355.5" r="5.4" fill="{card_fill}" stroke="{accent}" stroke-width="2"/>')
    out.append(f'<circle cx="{mx:.1f}" cy="355.5" r="2.1" fill="{accent}"/>')

    # choice detail
    selected_fg = '#ffffff' if skin == 'light' else '#151b2a'
    out.extend(pill(890, 395, 82, 28, 'refund', 14, choice, selected_fg, mono=True,
                    weight=700))
    out.append(T(1030, 414, '1 of 3', 14, muted, mono=True, anchor='end'))

    # score detail
    out.append(f'<line x1="890" y1="474" x2="1018" y2="474" stroke="{line}" stroke-width="3" stroke-linecap="round"/>')
    out.append(f'<line x1="890" y1="474" x2="986" y2="474" stroke="{score}" stroke-width="3" stroke-linecap="round"/>')
    for i, xx in enumerate([890, 922, 954, 986, 1018]):
        out.append(f'<circle cx="{xx}" cy="474" r="3.2" fill="{score}"/>')
    out.append(f'<circle cx="986" cy="474" r="6.8" fill="{card_fill}" stroke="{score}" stroke-width="2"/>')
    out.append(f'<circle cx="986" cy="474" r="2.5" fill="{score}"/>')

    # sidecar footer
    out.append(f'<line x1="636" y1="518" x2="1034" y2="518" stroke="{line}" stroke-width="1.1"/>')
    out.append(T(636, 540, 'plan_questions() feeds both routes', 14, muted))
    out.append(T(1034, 540, 'answers return typed', 14, accent, mono=True, weight=700, anchor='end'))

    # page footer
    out.append(f'<line x1="44" y1="584" x2="1056" y2="584" stroke="{line}" stroke-width="1.3"/>')
    out.append(T(44, 608,
                 'non-loopback sidecarUrl is allowed; it warns once and the startup line says LEAVES THIS MACHINE.',
                 14, muted))
    out.append(T(1056, 608, 'lifecycle  never | attach | spawn', 14, muted, mono=True, anchor='end'))
    out.append(T(44, 634,
                 'Routes  laya_ask / ctx.laya.ask → POST /ask   ·   laya_plan / ctx.laya.plan → POST /plan',
                 14, body, mono=True))
    out.append(T(1056, 634, 'health / capabilities  GET', 14, muted, mono=True, anchor='end'))
    out.append('</svg>')
    return "\n".join(out) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            image = hero(lang, skin)
            path = os.path.join(OUT, f"dsh-laya-hero-{lang}-{skin}.webp")
            image.save(path, "WEBP", quality=93, method=6)
            print(f"wrote {os.path.relpath(path, ROOT)}")
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-laya-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
