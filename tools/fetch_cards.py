#!/usr/bin/env python3
"""Fetch and document the 78 public-domain RWS 1909 card scans from Commons."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CATEGORY = "Category:Rider-Waite tarot deck (Roses & Lilies)"
SUITS = ("Wands", "Cups", "Swords", "Pentacles")
USER_AGENT = "TarotTableAssetFetcher/1.0 (source attribution; public domain scans)"


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def card_id(title):
    major = re.fullmatch(r"File:RWS1909 - (\d\d) [^.]+\.jpeg", title)
    if major and 0 <= int(major.group(1)) <= 21:
        return int(major.group(1))
    minor = re.fullmatch(r"File:RWS1909 - (Wands|Cups|Swords|Pentacles) (\d\d)\.jpeg", title)
    if minor and 1 <= int(minor.group(2)) <= 14:
        return 22 + SUITS.index(minor.group(1)) * 14 + int(minor.group(2)) - 1
    return None


def catalog():
    def query(params):
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", **params})
        return json.loads(fetch(url))
    members = query({"list": "categorymembers", "cmtitle": CATEGORY,
                     "cmtype": "file", "cmlimit": "max"})["query"]["categorymembers"]
    titles = [member["title"] for member in members if card_id(member["title"]) is not None]
    cards = {}
    for start in range(0, len(titles), 20):
        pages = query({"titles": "|".join(titles[start:start + 20]), "prop": "imageinfo",
                       "iiprop": "url|extmetadata", "iiurlwidth": "308"})["query"]["pages"]
        for page in pages.values():
            ident = card_id(page["title"])
            info = page["imageinfo"][0]
            license_name = info["extmetadata"]["LicenseShortName"]["value"]
            if license_name != "Public domain":
                raise ValueError(f"Card {ident} has unexpected license: {license_name}")
            cards[ident] = {"id": ident, "title": page["title"], "source_page": info["descriptionurl"],
                            "license": license_name, "thumbnail_url": info["thumburl"]}
    if set(cards) != set(range(78)):
        raise ValueError(f"Expected all 78 cards; found {len(cards)}")
    return [cards[ident] for ident in range(78)]


def save_card(entry):
    raw = fetch(entry["thumbnail_url"])
    with Image.open(io.BytesIO(raw)) as image:
        output = io.BytesIO()
        image.convert("RGB").save(output, "WEBP", quality=88, method=6)
    pixels = output.getvalue()
    target = ROOT / "cards" / f"{entry['id']}.webp"
    target.write_bytes(pixels)
    return {**entry, "thumbnail_sha256": hashlib.sha256(raw).hexdigest(),
            "webp_sha256": hashlib.sha256(pixels).hexdigest()}


def main():
    (ROOT / "cards").mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = list(pool.map(save_card, catalog()))
    (ROOT / "ASSET_SOURCES.json").write_text(json.dumps({"category": CATEGORY, "cards": entries},
                                                     ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(entries)} cards to {ROOT / 'cards'}")


if __name__ == "__main__":
    main()
