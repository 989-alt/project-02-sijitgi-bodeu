"""Take a polished hero screenshot for README — shows 5-3 class with sample poems."""

import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:5181")
OUT = Path(__file__).parent.parent / "screenshot.png"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        # seed class + poems
        page.evaluate(
            """() => {
              localStorage.clear();
              const cid = 'demo-class-1';
              const classes = [{
                id: cid,
                name: '5-3',
                note: '',
                createdAt: new Date().toISOString(),
              }];
              localStorage.setItem('sijitgi-bodeu.classes.v1', JSON.stringify(classes));
              localStorage.setItem('sijitgi-bodeu.activeClassId.v1', cid);
              const poems = [
                { id: 'p1', acrostic: '사랑해', lines: [
                  {head:'사', text:'사이좋게 손을 잡고'},
                  {head:'랑', text:'랑랑한 목소리로 노래해요'},
                  {head:'해', text:'해님처럼 따뜻하게'},
                ], author: '지우', createdAt: '2026-05-13T00:00:00.000Z' },
                { id: 'p2', acrostic: '봄', lines: [
                  {head:'봄', text:'봄바람이 살랑살랑 불어오네요'},
                ], author: '한별', createdAt: '2026-05-13T00:00:00.000Z' },
                { id: 'p3', acrostic: '꿈', lines: [
                  {head:'꿈', text:'꿈을 꾸면 내일이 보여요'},
                ], author: '익명', createdAt: '2026-05-13T00:00:00.000Z' },
              ];
              localStorage.setItem('sijitgi-bodeu.poems.v2.' + cid, JSON.stringify(poems));
            }"""
        )
        page.reload(wait_until="domcontentloaded")
        page.fill("#acrostic", "별빛")
        page.click("#start-btn")
        page.locator(".line-input").nth(0).fill("별이 반짝이는 밤하늘")
        page.locator(".line-input").nth(1).fill("빛으로 가득 차요")
        page.fill("#author", "유나")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT), full_page=False)
        print(f"Saved: {OUT}")
        browser.close()


if __name__ == "__main__":
    main()
