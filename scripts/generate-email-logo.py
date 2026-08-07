#!/usr/bin/env python3
"""Generate the SecretaryHQ email header logo.

WHY THIS EXISTS: emails need a raster logo. SVG is not rendered by Outlook,
Gmail's web client, or most mobile clients, so the header has to be a PNG. This
script is the SOURCE for `assets/email/logo.png` — regenerate rather than
hand-editing the binary, so the asset stays reproducible and reviewable.

Rendered at 2x (560x112) and displayed at 280x56 in the email, so it stays sharp
on retina/high-DPI screens.

Usage:  python3 scripts/generate-email-logo.py
"""

from PIL import Image, ImageDraw, ImageFont

# Navy brand scheme.
NAVY = (27, 43, 75)
NAVY_DEEP = (17, 28, 51)
ACCENT = (94, 141, 214)
WHITE = (255, 255, 255)

SCALE = 2
W, H = 280 * SCALE, 56 * SCALE

BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# ── Badge: navy rounded square with an "S" monogram ──
badge = 44 * SCALE
bx, by = 0, (H - badge) // 2
d.rounded_rectangle([bx, by, bx + badge, by + badge], radius=11 * SCALE, fill=NAVY)

mono = ImageFont.truetype(BOLD, 26 * SCALE)
mb = d.textbbox((0, 0), "S", font=mono)
d.text(
    (bx + (badge - (mb[2] - mb[0])) / 2 - mb[0], by + (badge - (mb[3] - mb[1])) / 2 - mb[1]),
    "S",
    font=mono,
    fill=WHITE,
)

# A small accent dot — reads as the "active line" indicator on the badge.
dot = 7 * SCALE
d.ellipse(
    [bx + badge - dot - 5 * SCALE, by + 5 * SCALE, bx + badge - 5 * SCALE, by + 5 * SCALE + dot],
    fill=ACCENT,
)

# ── Wordmark: "Secretary" in navy, "HQ" in the accent ──
word = ImageFont.truetype(BOLD, 21 * SCALE)
tx = bx + badge + 12 * SCALE
wb = d.textbbox((0, 0), "SecretaryHQ", font=word)
ty = (H - (wb[3] - wb[1])) / 2 - wb[1]

d.text((tx, ty), "Secretary", font=word, fill=NAVY_DEEP)
sw = d.textlength("Secretary", font=word)
d.text((tx + sw, ty), "HQ", font=word, fill=ACCENT)

img.save("assets/email/logo.png", "PNG", optimize=True)
print(f"wrote assets/email/logo.png ({W}x{H}, displayed at {W // SCALE}x{H // SCALE})")

# Also emit the bytes as a TS module. The mailer embeds the logo as a CID
# attachment, and reading a file at send time means resolving a path that
# differs between `src/` (ts-node, tests) and `dist/` (prod) — a miss there
# degrades silently to a logo-less email, which is exactly the bug we are
# fixing. Base64 in the bundle has no path to get wrong.
import base64
import textwrap

b64 = base64.b64encode(open("assets/email/logo.png", "rb").read()).decode()
body = "\n".join("  '" + c + "' +" for c in textwrap.wrap(b64, 96))
ts = f"""// GENERATED FILE — do not edit by hand.
// Source: scripts/generate-email-logo.py  ·  Asset: assets/email/logo.png
//
// The SecretaryHQ email header logo, base64-encoded. Embedded rather than read
// from disk so there is no path to resolve differently between src/ and dist/.
// Regenerate with: python3 scripts/generate-email-logo.py

export const EMAIL_LOGO_PNG_BASE64 =
{body[:-2]};
"""
open("src/services/communications/emailLogo.ts", "w").write(ts)
print("wrote src/services/communications/emailLogo.ts")
