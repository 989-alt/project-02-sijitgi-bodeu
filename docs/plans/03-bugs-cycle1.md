# Cycle 1 버그 보고

## P1-01 · `.empty-state` 가 `hidden` 속성을 무시
- **재현**: 작품 저장 → 갤러리에 1편 표시. 같은 위치의 `#gallery-empty` div 도 그대로 보임.
- **원인**: CSS `.empty-state { display: flex; ... }` 가 같은 우선순위의 `[hidden]` UA 룰을 후순위로 덮어쓰기 때문에 `display: flex` 가 이김.
- **기대**: `hidden` 속성이 붙으면 무조건 비표시.
- **해결**: 글로벌 `[hidden] { display: none !important; }` 룰 추가 (가장 안전).

기타 테스트는 모두 통과: `keyboard_shortcuts`, `json_export_import_args`, `empty_save_blocked`.
