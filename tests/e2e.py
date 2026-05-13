"""
E2E test suite — 시 짓기 보드 (with classroom workspaces).

BASE_URL env var sets the target. Default: http://127.0.0.1:5180.

Coverage:
1. First visit shows welcome modal; creating a class lets the user write a poem.
2. Acrostic decomposition: "사랑해" -> 3 line rows, save -> appears in gallery.
3. Reload persists poems within the active class.
4. Present mode opens, ESC closes.
5. Empty state on delete; empty present mode shows guidance.
6. JSON export/import for the active class.
7. Keyboard shortcuts: Enter / Ctrl+Enter / R.
8. Class isolation: two classes have independent galleries.
9. Migration: legacy v1 storage is moved into "우리반" on first load.
10. No console / page errors throughout (CDN noise filtered).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import (
    ConsoleMessage,
    Page,
    expect,
    sync_playwright,
)

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:5180")
SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)

CDN_NOISE_PATTERNS = [
    r"html2canvas",
    r"html2pdf",
    r"jsdelivr",
    r"cdn\.tailwindcss",
    r"net::ERR_",
    r"Failed to load resource",
    r"fonts\.gstatic",
    r"fonts\.googleapis",
]


def is_noise(text: str) -> bool:
    return any(re.search(p, text) for p in CDN_NOISE_PATTERNS)


def shot(page: Page, name: str) -> None:
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)


class Tracker:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.page_errors: list[str] = []

    def on_console(self, msg: ConsoleMessage) -> None:
        if msg.type == "error" and not is_noise(msg.text):
            self.errors.append(msg.text)

    def on_pageerror(self, err) -> None:
        text = str(err)
        if not is_noise(text):
            self.page_errors.append(text)


def attach_tracker(page: Page) -> Tracker:
    t = Tracker()
    page.on("console", t.on_console)
    page.on("pageerror", t.on_pageerror)
    return t


def clear_storage(page: Page) -> None:
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate("() => localStorage.clear()")


def reload(page: Page) -> None:
    page.reload(wait_until="domcontentloaded")


def create_class_via_welcome(page: Page, name: str) -> None:
    expect(page.locator("#welcome-modal")).to_be_visible()
    page.fill("#welcome-class-input", name)
    page.click("#welcome-form button[type='submit']")
    expect(page.locator("#welcome-modal")).to_be_hidden()
    expect(page.locator("#class-chip")).to_be_visible()
    expect(page.locator("#class-chip-name")).to_have_text(name)


def test_welcome_then_save(page: Page) -> None:
    t = attach_tracker(page)
    clear_storage(page)
    reload(page)

    # 1) Welcome modal appears
    expect(page.locator(".brand-title")).to_have_text("시 짓기 보드")
    expect(page.locator("#welcome-modal")).to_be_visible()
    expect(page.locator("#acrostic")).to_be_disabled()
    shot(page, "01-welcome")

    # 2) Create class
    create_class_via_welcome(page, "5-3")
    expect(page.locator("#acrostic")).to_be_enabled()
    expect(page.locator("#class-chip-count")).to_have_text("0편")

    # 3) Acrostic decomposition
    page.fill("#acrostic", "사 랑 해")
    page.click("#start-btn")
    expect(page.locator(".line-row")).to_have_count(3)
    heads = page.eval_on_selector_all(
        ".line-head", "els => els.map(e => e.textContent)"
    )
    assert heads == ["사", "랑", "해"], f"heads={heads!r}"

    # 4) Fill + save
    inputs = page.locator(".line-input")
    inputs.nth(0).fill("사이 좋게 지내요")
    inputs.nth(1).fill("랑랑하게 노래해요")
    inputs.nth(2).fill("해님처럼 빛나요")
    page.fill("#author", "지우")
    shot(page, "02-filled")
    page.click("#save-btn")

    expect(page.locator("#poem-count")).to_have_text("1편")
    expect(page.locator("#class-chip-count")).to_have_text("1편")
    expect(page.locator(".poem-card")).to_have_count(1)
    expect(page.locator(".poem-card .author")).to_have_text("지우")
    expect(page.locator("#gallery-empty")).to_be_hidden()
    shot(page, "03-saved")

    # 5) Reload persists
    reload(page)
    expect(page.locator("#welcome-modal")).to_be_hidden()
    expect(page.locator(".poem-card")).to_have_count(1)
    expect(page.locator("#class-chip-name")).to_have_text("5-3")
    expect(page.locator("#class-chip-count")).to_have_text("1편")

    # 6) Present mode
    page.click("#present-btn")
    expect(page.locator("#present")).to_be_visible()
    expect(page.locator(".present-body")).to_contain_text("사이 좋게 지내요")
    # class name appears in present author line
    expect(page.locator(".present-author")).to_contain_text("5-3")
    shot(page, "04-present")
    page.keyboard.press("Escape")
    expect(page.locator("#present")).to_be_hidden()

    # 7) Delete
    page.hover(".poem-card")
    page.once("dialog", lambda d: d.accept())
    page.click(".poem-card [data-action='delete']")
    expect(page.locator(".poem-card")).to_have_count(0)
    expect(page.locator("#gallery-empty")).to_be_visible()
    shot(page, "05-empty")

    # 8) Empty present mode
    page.click("#present-btn")
    expect(page.locator(".present-empty")).to_be_visible()
    page.keyboard.press("Escape")

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def test_keyboard_shortcuts(page: Page) -> None:
    t = attach_tracker(page)
    clear_storage(page)
    reload(page)
    create_class_via_welcome(page, "테스트반")

    page.fill("#acrostic", "별")
    page.keyboard.press("Enter")
    expect(page.locator(".line-row")).to_have_count(1)
    page.locator(".line-input").first.fill("별빛이 반짝여요")
    page.locator(".line-input").first.press("Control+Enter")
    expect(page.locator(".poem-card")).to_have_count(1)

    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("r")
    expect(page.locator("#present")).to_be_visible()
    page.keyboard.press("Escape")

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def test_json_export_import(page: Page, download_dir: Path) -> None:
    t = attach_tracker(page)
    clear_storage(page)
    reload(page)
    create_class_via_welcome(page, "JSON 반")

    page.evaluate(
        """() => {
          window.__app.addPoem({
            acrostic: '봄',
            lines: [{ head: '봄', text: '봄이 왔어요' }],
            author: '하늘',
          });
          window.__app.addPoem({
            acrostic: '가을',
            lines: [
              { head: '가', text: '가벼운 바람' },
              { head: '을', text: '을의 들녘' },
            ],
            author: '한별',
          });
        }"""
    )
    expect(page.locator(".poem-card")).to_have_count(2)

    with page.expect_download() as dl_info:
        page.click("#export-btn")
        page.click("#export-menu [data-action='export-json']")
    download = dl_info.value
    target = download_dir / "exported.json"
    download.save_as(str(target))
    data = json.loads(target.read_text())
    # 새 형식: { class, poems }
    assert isinstance(data, dict), f"expected dict, got {type(data)}"
    assert data.get("class", {}).get("name") == "JSON 반"
    assert len(data.get("poems", [])) == 2

    # 작품만 삭제 후 import (학급은 유지)
    page.evaluate(
        """() => {
          const id = window.__app.state.activeId;
          localStorage.removeItem('sijitgi-bodeu.poems.v2.' + id);
        }"""
    )
    reload(page)
    expect(page.locator(".poem-card")).to_have_count(0)

    page.set_input_files("#import-file", str(target))
    expect(page.locator(".poem-card")).to_have_count(2)

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def test_empty_save_blocked(page: Page) -> None:
    t = attach_tracker(page)
    clear_storage(page)
    reload(page)
    create_class_via_welcome(page, "빈검사반")

    page.fill("#acrostic", "가나")
    page.click("#start-btn")
    expect(page.locator("#save-btn")).to_be_disabled()
    page.locator(".line-input").first.fill("가위바위보")
    expect(page.locator("#save-btn")).to_be_enabled()

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def test_class_isolation(page: Page) -> None:
    """학급마다 갤러리가 분리되고, 학급 전환 시 갤러리 통째로 바뀐다."""
    t = attach_tracker(page)
    clear_storage(page)
    reload(page)
    create_class_via_welcome(page, "5-3")

    # 5-3 학급에 작품 2개
    page.evaluate(
        """() => {
          window.__app.addPoem({ acrostic: '5반', lines: [{head:'5', text:'다섯반 친구들'}, {head:'반', text:'반갑게 만나'}], author: 'A' });
          window.__app.addPoem({ acrostic: '봄', lines: [{head:'봄', text:'봄날 한 줄'}], author: 'B' });
        }"""
    )
    expect(page.locator(".poem-card")).to_have_count(2)
    expect(page.locator("#class-chip-name")).to_have_text("5-3")

    # 학급 관리 모달에서 새 학급 만들기
    page.click("#class-chip")
    expect(page.locator("#classes-modal")).to_be_visible()
    page.fill("#new-class-input", "6-1")
    page.click("#new-class-form button[type='submit']")

    # 학급 리스트에 두 개 보임
    rows = page.locator(".class-row")
    expect(rows).to_have_count(2)

    # 새로 추가된 학급은 자동으로 활성 (createClass → setActiveClass)
    # 모달 닫기
    page.click("#classes-modal [data-close-modal]")
    expect(page.locator("#class-chip-name")).to_have_text("6-1")
    expect(page.locator(".poem-card")).to_have_count(0)
    expect(page.locator("#gallery-empty")).to_be_visible()

    # 6-1 학급에 작품 1개
    page.evaluate(
        """() => {
          window.__app.addPoem({ acrostic: '꿈', lines: [{head:'꿈', text:'꿈을 꾸는 6반'}], author: 'C' });
        }"""
    )
    expect(page.locator(".poem-card")).to_have_count(1)

    # 학급 다시 전환 → 5-3
    page.click("#class-chip")
    expect(page.locator("#classes-modal")).to_be_visible()
    # 5-3 행에서 '전환' 버튼 클릭
    page.click(".class-row button[data-act='switch']")
    page.click("#classes-modal [data-close-modal]")
    expect(page.locator("#class-chip-name")).to_have_text("5-3")
    expect(page.locator(".poem-card")).to_have_count(2)

    # 다시 6-1로 전환
    page.click("#class-chip")
    page.click(".class-row button[data-act='switch']")
    page.click("#classes-modal [data-close-modal]")
    expect(page.locator("#class-chip-name")).to_have_text("6-1")
    expect(page.locator(".poem-card")).to_have_count(1)

    # 학급 삭제 → 6-1 삭제
    page.click("#class-chip")
    page.once("dialog", lambda d: d.accept())
    # 활성 학급 6-1의 삭제 버튼
    page.click(".class-row.is-active button[data-act='delete']")
    # 5-3 만 남고 자동 전환
    page.click("#classes-modal [data-close-modal]")
    expect(page.locator("#class-chip-name")).to_have_text("5-3")
    expect(page.locator(".poem-card")).to_have_count(2)

    # 새로고침해도 분리 유지
    reload(page)
    expect(page.locator("#class-chip-name")).to_have_text("5-3")
    expect(page.locator(".poem-card")).to_have_count(2)

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def test_legacy_migration(page: Page) -> None:
    """v1 단일 저장소에서 자동으로 '우리반' 학급으로 이관."""
    t = attach_tracker(page)
    # 어떤 학급도 없는 상태에서 legacy 키만 채우고 새로고침
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate(
        """() => {
          localStorage.clear();
          const legacy = [{
            id: 'old-1',
            acrostic: '여름',
            lines: [
              { head: '여', text: '여름 한낮의' },
              { head: '름', text: '름은 매미 소리' },
            ],
            author: '옛친구',
            createdAt: '2025-06-01T00:00:00.000Z',
          }];
          localStorage.setItem('sijitgi-bodeu.poems.v1', JSON.stringify(legacy));
        }"""
    )
    reload(page)

    # 환영 모달은 뜨지 않아야 함 (마이그레이션으로 학급이 자동 생성됐으니)
    expect(page.locator("#welcome-modal")).to_be_hidden()
    expect(page.locator("#class-chip-name")).to_have_text("우리반")
    expect(page.locator(".poem-card")).to_have_count(1)
    # 옛 키는 비워졌어야 함
    legacy_remaining = page.evaluate(
        "() => localStorage.getItem('sijitgi-bodeu.poems.v1')"
    )
    assert legacy_remaining is None, f"legacy key remained: {legacy_remaining!r}"

    if t.errors:
        raise AssertionError("Console errors:\n" + "\n".join(t.errors))
    if t.page_errors:
        raise AssertionError("Page errors:\n" + "\n".join(t.page_errors))


def main() -> int:
    tests = [
        ("welcome_then_save", test_welcome_then_save),
        ("keyboard_shortcuts", test_keyboard_shortcuts),
        ("json_export_import_args", test_json_export_import),
        ("empty_save_blocked", test_empty_save_blocked),
        ("class_isolation", test_class_isolation),
        ("legacy_migration", test_legacy_migration),
    ]

    download_dir = Path(__file__).parent / "downloads"
    download_dir.mkdir(exist_ok=True)
    failed = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for name, fn in tests:
                context = browser.new_context(
                    accept_downloads=True,
                    viewport={"width": 1366, "height": 900},
                )
                page = context.new_page()
                t0 = time.time()
                try:
                    if name == "json_export_import_args":
                        fn(page, download_dir)
                    else:
                        fn(page)
                    print(f"  ✓ {name}  ({time.time()-t0:.1f}s)")
                except Exception as e:
                    failed.append((name, str(e)))
                    print(f"  ✗ {name}  ({time.time()-t0:.1f}s)\n    {e}")
                    try:
                        shot(page, f"FAIL-{name}")
                    except Exception:
                        pass
                finally:
                    context.close()
        finally:
            browser.close()

    print("---")
    print(f"Passed: {len(tests) - len(failed)} / {len(tests)}")
    if failed:
        print("Failures:")
        for n, msg in failed:
            print(f"  - {n}: {msg[:300]}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
