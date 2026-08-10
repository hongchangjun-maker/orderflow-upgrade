from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ICON_NAMES = (
    "dashboard",
    "orders",
    "products",
    "forms",
    "customers",
    "analytics",
    "settings",
    "search",
    "cart",
    "delivery",
    "payment",
    "inventory",
)

PRODUCT_NAMES = (
    "peach",
    "egg",
    "chicken",
    "melon",
    "kimchi",
    "curry",
    "pancake",
    "noodle",
)


def save_webp(image: Image.Image, path: Path, *, quality: int = 88) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, "WEBP", quality=quality, method=6)


def split_grid(source: Path, names: tuple[str, ...], columns: int, rows: int, out_dir: Path) -> None:
    image = Image.open(source)
    width, height = image.size
    cell_width = width / columns
    cell_height = height / rows
    for index, name in enumerate(names):
        column = index % columns
        row = index // columns
        left = round(column * cell_width)
        top = round(row * cell_height)
        right = round((column + 1) * cell_width)
        bottom = round((row + 1) * cell_height)
        crop = image.crop((left, top, right, bottom))
        save_webp(crop, out_dir / f"{name}.webp")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare generated ORDERFLOW visual assets.")
    parser.add_argument("--logo", type=Path, required=True)
    parser.add_argument("--icons", type=Path, required=True)
    parser.add_argument("--products", type=Path, required=True)
    parser.add_argument("--hero", type=Path, required=True)
    parser.add_argument("--social", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    args = parser.parse_args()

    visual_dir = args.public / "visuals"
    split_grid(args.icons, ICON_NAMES, 4, 3, visual_dir / "icons")
    split_grid(args.products, PRODUCT_NAMES, 4, 2, visual_dir / "products")

    logo = Image.open(args.logo)
    save_webp(logo, visual_dir / "orderflow-mark.webp", quality=92)
    hero = Image.open(args.hero)
    save_webp(hero, visual_dir / "operations-hero.webp", quality=88)
    social = Image.open(args.social)
    save_webp(social, args.public / "og.webp", quality=90)


if __name__ == "__main__":
    main()
