# 비밀정원 🌸 cozyflowerDB

게임 "꽃" 도감 + 길드원 보유 현황을 보는 로컬 웹앱.

## 쓰는 법
1. `index.html`을 브라우저로 연다 (더블클릭).
2. **꽃 보기**: 꽃별 보유 길드원 목록.
3. **내 꽃 입력**: 닉네임 + 가진 꽃 체크 후 저장.
4. **백업**: 헤더의 내보내기/불러오기로 데이터를 JSON으로 저장·복원.

데이터는 이 브라우저의 localStorage에 저장됩니다. 다른 PC로 옮기려면 백업 파일을 쓰세요.

## 개발
- 테스트: `node --test`
- 꽃 이미지 재크롭: `cd tools && npm install && node crop.mjs`

## 나중에 길드원 실시간 공유로 확장
`js/store.js`의 저장 계층을 Firebase Firestore 버전으로 교체하고 무료 정적 호스팅에 올리면 됩니다. 인터페이스(getAllMembers/getMember/saveMember/...)는 그대로 유지하세요.
