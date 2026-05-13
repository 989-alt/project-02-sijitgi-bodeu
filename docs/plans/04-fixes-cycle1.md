# Cycle 1 수정 보고

## P1-01 fix
- `styles.css` 상단(`* { box-sizing: border-box; }` 직후)에 글로벌 룰 추가:
  ```css
  [hidden] { display: none !important; }
  ```
- 컴포넌트별 `display: flex|grid|block` 룰이 `[hidden]` 의 UA `display: none` 을 후순위로 덮어쓰는 문제를 한 줄로 해결.
- `.present[hidden]`, `.modal[hidden]` 개별 룰은 그대로 둠 (가독성).
- 다른 hidden 요소(`#export-menu`, `#toast`, `#gallery-empty`)도 같은 보장.
