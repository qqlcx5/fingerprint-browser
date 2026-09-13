#!/usr/bin/env python3
"""Generate Pi desktop GUI icons from the original geometric design.

Colors:
  - Background: Charcoal #36454F
  - Foreground: Tangerine #e67e22
"""

from pathlib import Path
from PIL import Image
import subprocess

ICON_DIR = Path(__file__).resolve().parent
OUTPUT_SIZES = [16, 32, 48, 64, 128, 256, 512]

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <!-- Charcoal rounded background -->
  <rect width="512" height="512" rx="77" fill="#36454F"/>

  <!-- Pi letterforms: official brand marks, scaled from 800 -> 512 -->
  <g transform="translate(5.5, 5.5) scale(0.62625)">
    <!-- P shape: outer boundary clockwise, inner hole counter-clockwise -->
    <path fill="#e67e22" fill-rule="evenodd" d="
      M165.29 165.29
      H517.36
      V400
      H400
      V517.36
      H282.65
      V634.72
      H165.29
      Z
      M282.65 282.65
      V400
      H400
      V282.65
      Z
    "/>
    <!-- i dot -->
    <path fill="#e67e22" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
  </g>
</svg>'''


def svg_to_png(svg_path: Path, size: int, out_path: Path):
    """Convert SVG to PNG using ImageMagick."""
    subprocess.run(
        ["convert", "-background", "none", "-density", "300",
         f"{svg_path}", "-resize", f"{size}x{size}", str(out_path)],
        check=True, capture_output=True,
    )


def main():
    print("Generating Pi icons (tangerine #e67e22 on charcoal #36454F)...")

    # Write SVG
    svg_path = ICON_DIR / "icon.svg"
    svg_path.write_text(SVG)
    print(f"  ✓ {svg_path.name}")

    # Generate PNGs via ImageMagick
    for size in OUTPUT_SIZES:
        out_path = ICON_DIR / f"icon-{size}.png"
        svg_to_png(svg_path, size, out_path)
        print(f"  ✓ {out_path.name} ({size}×{size})")

    # Alias icon.png → icon-512.png
    icon_png = ICON_DIR / "icon.png"
    icon_png.write_bytes((ICON_DIR / "icon-512.png").read_bytes())
    print(f"  ✓ {icon_png.name} (copy of icon-512.png)")

    # Multi-resolution ICO
    print("  Generating icon.ico ...")
    ico_sizes = [16, 32, 48, 64, 128, 256]
    # Build ICO using ImageMagick: append all sizes into one file
    args = ["convert"]
    for size in ico_sizes:
        args.extend([str(ICON_DIR / f"icon-{size}.png")])
    args.append(str(ICON_DIR / "icon.ico"))
    subprocess.run(args, check=True, capture_output=True)
    print(f"  ✓ icon.ico ({ico_sizes})")

    print("\nAll icons generated successfully!")


if __name__ == "__main__":
    main()
