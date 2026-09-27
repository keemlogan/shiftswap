// 과제 설명서(TermProjectDescription-SE_2026_2)의 요구사항을 빠짐없이 나열하고,
// 각 요구사항을 충족하는 결과물 위치를 연결한다. 요구사항 문구는 한글 번역본 기준.

export const TODAY = "2026-09-27";

export const GROUPS = [
  { id: "topic", week: null, due: null, label: "주제 조건", note: "제안서 단계에서 지켜야 하는 주제 제약" },
  { id: "w3", week: 3, due: "2026-09-18", label: "팀 구성", note: "3주차 마감" },
  { id: "w5", week: 5, due: "2026-10-02", label: "제안서", note: "5주차 마감 · PDF 이메일 제출" },
  { id: "w7", week: 7, due: "2026-10-16", label: "중간 보고서", note: "7주차 마감" },
  { id: "w14", week: 14, due: "2026-12-04", label: "최종 보고서", note: "14주차 마감 · PDF 이메일 제출" },
  { id: "talk", week: 14, due: "2026-12-04", label: "발표", note: "마지막 주 · 약 15분" },
  { id: "eval", week: null, due: null, label: "평가 기준 대응", note: "최종 보고서 30% + 발표 10%" },
];

const P = "docs/proposal.html";
const I = "docs/interim.html";
const F = "docs/final-report.html";
const doc = (label, href) => ({ label, href, kind: "doc" });
const pdf = (label, href) => ({ label, href, kind: "pdf" });
const img = (label, href) => ({ label, href, kind: "img" });
const app = (label, href) => ({ label, href, kind: "app" });
const ext = (label, href) => ({ label, href, kind: "ext" });

export const ITEMS = [
  // 주제 조건
  { id: "T-1", group: "topic", title: "정보 시스템 개발 중심, 전통적인 트랜잭션 처리 업무 시스템",
    quote: "AI나 데이터 분석 도구와 같은 신기술을 중심으로 구축된 시스템보다는, 전통적인 트랜잭션 처리 업무 응용 시스템을 권장한다.",
    answer: "근무표 생성, 대타 요청·수락·승인, 출퇴근 기록, 주간 집계, 월 급여 정산이 모두 상태가 바뀌는 업무 트랜잭션이다. AI 기능은 넣지 않았다.",
    evidence: [doc("최종 보고서 1장 · 범위", F + "#introduction"), app("실행 중인 앱", "app/")] },
  { id: "T-2", group: "topic", title: "핵심 유스케이스 5개 이상",
    quote: "대상 시스템은 최소 5개의 핵심 유스케이스와 최소 4개의 데이터베이스 테이블을 포함할 만큼 충분한 규모여야 한다.",
    answer: "유스케이스 13개(UC-01~UC-13). 이 중 핵심 9개가 제안서의 기능 9개와 1:1로 대응한다.",
    evidence: [img("유스케이스 다이어그램", "uml/usecase.svg"), doc("최종 보고서 3장 · 유스케이스 명세", F + "#requirements")] },
  { id: "T-3", group: "topic", title: "데이터베이스 테이블 4개 이상",
    quote: "최소 4개의 데이터베이스 테이블(또는 파일 구조)을 포함할 만큼 충분한 규모여야 한다.",
    answer: "SQLite 테이블 12개. 브라우저 안에서 실제 SQL 스키마로 동작한다.",
    evidence: [img("ERD", "uml/erd.svg"), ext("스키마 코드 (db.js)", "https://github.com/keemlogan/shiftswap/blob/main/app/core/db.js")] },
  { id: "T-4", group: "topic", title: "한 학기 안에 요구사항·설계·구현을 끝낼 수 있는 범위",
    quote: "한 학기 안에 요구사항 정의, 설계, 구현을 현실적으로 완료할 수 있는 주제를 선택할 것.",
    answer: "Must / Should / Won't로 범위를 나누고, 카카오 알림톡·4대보험·연차·퇴직금은 제외했다.",
    evidence: [doc("제안서 · 범위와 위험", P + "#scope")] },

  // 3주차
  { id: "W3-1", group: "w3", title: "2~3인 팀 구성과 팀원 명단 이메일 제출",
    quote: "팀원 중 한 명이 모든 팀원의 이름을 담당 교수에게 이메일로 보낸다(팀 이름은 선택적으로 포함할 수 있다).",
    answer: "7조: 김민경(23102004), 김형도(18102075), 김혜원(24102028). 3인 팀으로 구성했다. 조편성표 기준으로 이미 확정되었다.",
    evidence: [doc("최종 보고서 · 팀원과 역할", F + "#roles")] },

  // 5주차 제안서
  { id: "P-1", group: "w5", title: "제안한 시스템의 필요성",
    quote: "제안한 시스템의 필요성", answer: "사장이 대타를 구하려고 근무자에게 한 명씩 연락하고, 근무표와 주휴수당 조건을 손으로 다시 계산하는 문제.",
    evidence: [doc("제안서 · 필요성", P + "#need"), pdf("제안서 PDF", "docs/proposal.pdf")] },
  { id: "P-2", group: "w5", title: "프로젝트의 목표",
    quote: "프로젝트의 목표", answer: "측정 가능한 목표로 기술했다. 예: 대타 요청 1건을 한 번의 전달로 처리, 수락은 알림함에서 2번의 클릭 이내.",
    evidence: [doc("제안서 · 목표", P + "#goals")] },
  { id: "P-3", group: "w5", title: "주제가 다루는 문제에 대한 설명",
    quote: "주제가 다루는 문제에 대한 설명", answer: "현재 업무 방식과 문제 P1~P3.",
    evidence: [doc("제안서 · 문제 설명", P + "#problem")] },
  { id: "P-4", group: "w5", title: "대상 정보 시스템의 주요 기능(가능한 한 상세히)",
    quote: "대상 정보 시스템의 주요 기능(가능한 한 상세히 기술)", answer: "유스케이스 13개를 행위자·트리거·결과·업무 규칙·테이블 단위로 기술했다.",
    evidence: [doc("제안서 · 주요 기능", P + "#functions")] },
  { id: "P-5", group: "w5", title: "작업분해구조(WBS)",
    quote: "학기 프로젝트 수행을 위한 작업분해구조(WBS)", answer: "8개 작업 영역, 2단계 분해. 말단 작업마다 담당자를 표시했다.",
    evidence: [img("WBS 다이어그램", "uml/wbs.svg"), doc("제안서 · WBS 표", P + "#wbs")] },
  { id: "P-6", group: "w5", title: "프로젝트 일정",
    quote: "학기 프로젝트 일정", answer: "3~14주차 주 단위 일정과 마일스톤 4개(팀 구성, 제안서, 중간 보고서, 최종 보고서·발표).",
    evidence: [img("간트 차트", "uml/gantt.svg"), doc("제안서 · 일정", P + "#schedule")] },
  { id: "P-7", group: "w5", title: "팀원별 역할",
    quote: "팀원별 역할", answer: "요구사항 리드 김혜원, PM·설계·구현 리드 김형도, UI·품질 리드 김민경.",
    evidence: [doc("제안서 · 역할", P + "#roles")] },

  // 7주차 중간
  { id: "I-1", group: "w7", title: "문제 설명", quote: "문제 설명",
    answer: "현재 업무 방식, 문제 P1~P3, 관련 법 기준.",
    evidence: [doc("중간 보고서 · 문제 설명", I + "#problem"), pdf("중간 보고서 PDF", "docs/interim.pdf")] },
  { id: "I-2", group: "w7", title: "기능 요구사항 명세", quote: "기능 요구사항 명세",
    answer: "FR-01~FR-21과 유스케이스 13개의 구조화된 명세(사전조건, 기본·대안·예외 흐름, 사후조건).",
    evidence: [doc("중간 보고서 · 기능 요구사항", I + "#functional")] },
  { id: "I-3", group: "w7", title: "비기능 요구사항 명세", quote: "비기능 요구사항 명세",
    answer: "NFR-01~NFR-12를 강의 8장 분류(Product / Organisational / External)대로 정리하고, 요구사항마다 검증 방법을 적었다. 최종 보고서에는 UX 요구사항 NFR-13이 추가되었다.",
    evidence: [doc("중간 보고서 · 비기능 요구사항", I + "#nonfunctional")] },
  { id: "I-4", group: "w7", title: "시나리오", quote: "시나리오",
    answer: "시드 데이터의 실제 인물·날짜로 쓴 시나리오: 중간고사 대타 요청, 동시 수락, 승인, 마감 만료, 월말 정산.",
    evidence: [doc("중간 보고서 · 시나리오", I + "#scenarios")] },
  { id: "I-5", group: "w7", title: "요구사항 분석을 위한 UML 다이어그램", quote: "요구사항 분석을 위한 UML 다이어그램",
    answer: "유스케이스, 활동(후보 선정·주휴 판정), 상태(대타 요청·근무·정산), 분석 클래스 다이어그램.",
    evidence: [doc("중간 보고서 · UML", I + "#uml"), img("상태: 대타 요청", "uml/state-subrequest.svg"), img("활동: 주휴 판정", "uml/activity-holiday.svg")] },
  { id: "I-6", group: "w7", title: "주요 사용자 인터페이스 화면", quote: "주요 사용자 인터페이스 화면",
    answer: "실제 배포된 앱의 화면 캡처 11장(데스크톱·모바일).",
    evidence: [doc("중간 보고서 · UI 화면", I + "#ui"), app("앱에서 직접 보기", "app/")] },

  // 14주차 최종
  { id: "F-1", group: "w14", title: "제목", quote: "제목",
    answer: "ShiftSwap: A Shift Schedule and Substitute Management System for Small Part-Time Workplaces",
    evidence: [doc("최종 보고서 표지", F + "#title"), pdf("최종 보고서 PDF", "docs/final-report.pdf")] },
  { id: "F-2", group: "w14", title: "팀원 이름, 이메일 주소, 소속", quote: "팀원 이름, 이메일 주소, 소속",
    answer: "표지에 기재했다. 김민경·김혜원의 이메일은 팀원이 직접 기입해야 한다.", todo: "팀원 이메일 2개 기입 필요",
    evidence: [doc("최종 보고서 표지", F + "#title")] },
  { id: "F-3", group: "w14", title: "팀원별 역할", quote: "팀원별 역할",
    answer: "WBS 작업 영역과 산출물에 대응시킨 역할 표.",
    evidence: [doc("최종 보고서 · 역할", F + "#roles")] },
  { id: "F-4", group: "w14", title: "초록(1~2문단)", quote: "초록 (보고서 내용을 1~2문단으로 요약)",
    answer: "2문단.", evidence: [doc("최종 보고서 · 초록", F + "#abstract")] },
  { id: "F-5", group: "w14", title: "배경 및 관련 연구를 포함한 문제 설명", quote: "배경 및 관련 연구를 포함한 문제 설명",
    answer: "현재 업무 흐름(DFD), 법 기준, 기존 근무 관리 서비스와의 기능 비교표.",
    evidence: [doc("최종 보고서 2장", F + "#problem")] },
  { id: "F-6", group: "w14", title: "요구사항 명세", quote: "요구사항 명세",
    answer: "FR 21개, NFR 13개, 업무 규칙 12개, 유스케이스 13개의 전체 명세, 시나리오, 검증.",
    evidence: [doc("최종 보고서 3장", F + "#requirements")] },
  { id: "F-7", group: "w14", title: "설계 명세", quote: "설계 명세",
    answer: "아키텍처(계층·컴포넌트·배포), 클래스 설계, DB 설계, 시퀀스 다이어그램 5개, 상태 설계, 화면 설계 원칙과 역할별 화면 구성.",
    evidence: [doc("최종 보고서 4장", F + "#design"), img("컴포넌트 다이어그램", "uml/component.svg")] },
  { id: "F-8", group: "w14", title: "시행착오로 다듬은 최종 프롬프트(재입력 시 시스템 재현)",
    quote: "반복적인 시행착오를 통해 다듬어진 최종 프롬프트 — 바이브 코딩에 다시 입력했을 때 동작하는 실행 가능한 시스템을 안정적으로 재현할 수 있어야 한다",
    answer: "앱은 이 프롬프트를 그대로 넣어 만들었다. 수정 이력은 프롬프트 로그에 남겼다.",
    evidence: [doc("최종 프롬프트", "prompts/final-prompt.html"), doc("프롬프트 로그", "prompts/prompt-log.html"), doc("최종 보고서 5장", F + "#implementation")] },
  { id: "F-9", group: "w14", title: "코드(첨부 파일)", quote: "코드 (첨부 파일로 제출하며, 분량 제한에서 제외됨)",
    answer: "GitHub 저장소 전체와 제출용 zip 파일.",
    evidence: [ext("GitHub 저장소", "https://github.com/keemlogan/shiftswap"), pdf("제출용 코드 zip", "downloads/shiftswap-code.zip")] },
  { id: "F-10", group: "w14", title: "실행 링크(배포된 웹 애플리케이션 URL)", quote: "실행 링크 (배포된 웹 애플리케이션의 URL)",
    answer: "https://keemlogan.github.io/shiftswap/app/ · 서버 없이 브라우저에서 동작한다. 데모 계정 5개.",
    evidence: [app("앱 열기", "app/")] },
  { id: "F-11", group: "w14", title: "참고 문헌", quote: "참고 문헌",
    answer: "법령, 고용노동부 고시, 교재, UML 명세, 관련 서비스.", evidence: [doc("최종 보고서 · 참고 문헌", F + "#references")] },
  { id: "F-12", group: "w14", title: "UML: 유스케이스 다이어그램(필수)", quote: "최소한 유스케이스 다이어그램, 클래스 다이어그램, 시퀀스 다이어그램이 보고서에 포함되어야 한다.",
    answer: "행위자 3, 유스케이스 13, include·extend 관계.", evidence: [img("유스케이스 다이어그램", "uml/usecase.svg")] },
  { id: "F-13", group: "w14", title: "UML: 클래스 다이어그램(필수)", quote: "클래스 다이어그램",
    answer: "엔티티 12개, 서비스 5개, LaborRules, 상태 열거형.", evidence: [img("클래스 다이어그램", "uml/class.svg")] },
  { id: "F-14", group: "w14", title: "UML: 시퀀스 다이어그램(필수)", quote: "시퀀스 다이어그램",
    answer: "대타 요청, 동시 수락(선착순), 승인 미리보기, 승인·반려와 주간 재집계, 월 급여 정산의 5개.",
    evidence: [img("SD-1 대타 요청", "uml/seq-1-request.svg"), img("SD-2 동시 수락", "uml/seq-2-accept.svg"), img("SD-3a 승인 미리보기", "uml/seq-3-approve-preview.svg"), img("SD-3b 승인·반려", "uml/seq-3-approve-decide.svg"), img("SD-4 급여 정산", "uml/seq-4-payroll.svg")] },
  { id: "F-15", group: "w14", title: "형식: 영어, 12pt, 줄 간격 1, 여백 1인치, 50~150쪽",
    quote: "줄 간격은 1줄(single-spaced), 글꼴 크기는 12포인트, 여백은 1인치로 하고, 분량은 50쪽 이상 150쪽 이하여야 한다. 보고서는 문법적으로 정확하고 명료한 영어 산문으로 작성해야 한다.",
    answer: "A4, Times 12pt, single-spaced, 1인치 여백으로 조판했다. 쪽수는 PDF 기준이다.", evidence: [pdf("최종 보고서 PDF", "docs/final-report.pdf")] },

  // 발표
  { id: "S-1", group: "talk", title: "PowerPoint 발표 자료", quote: "발표 자료는 PowerPoint를 사용하여 전자 문서로 준비해야 한다.",
    answer: ".pptx 파일과 웹 미리보기.", evidence: [pdf("발표 자료 (.pptx)", "presentation/ShiftSwap-Team7.pptx"), doc("웹 미리보기", "presentation/index.html")] },
  { id: "S-2", group: "talk", title: "약 15분 분량, 팀원별 균등 발표", quote: "각 팀은 약 15분 분량으로 계획해야 한다. 각 팀원은 대략 동일한 시간씩 발표해야 한다.",
    answer: "슬라이드마다 발표자와 예상 시간을 발표자 노트에 적었다. 팀원당 약 5분.", evidence: [doc("발표 대본·시간 배분", "presentation/index.html#script")] },

  // 평가
  { id: "E-1", group: "eval", title: "프로젝트 복잡도 (5%)", quote: "프로젝트 복잡도 수준 (5%)",
    answer: "행위자 3, 유스케이스 13, 테이블 12, 업무 규칙 12, 상태 기계 3개, 선착순 수락 동시성, 법 기준 계산.",
    evidence: [doc("최종 보고서 · 결론", F + "#conclusion")] },
  { id: "E-2", group: "eval", title: "요구사항과 설계 간의 일관성", quote: "요구사항과 설계 간의 일관성",
    answer: "FR → UC → 화면·서비스 함수 → 업무 규칙 → 테스트 케이스의 추적 매트릭스.",
    evidence: [doc("추적 매트릭스", F + "#traceability")] },
  { id: "E-3", group: "eval", title: "프롬프트의 품질", quote: "프롬프트의 품질",
    answer: "명세 전체를 계약으로 넣고, 기술 제약·화면·디자인·완료 조건을 분리한 구조.",
    evidence: [doc("최종 프롬프트", "prompts/final-prompt.html"), doc("프롬프트 로그", "prompts/prompt-log.html")] },
  { id: "E-4", group: "eval", title: "코드의 정확성", quote: "코드의 정확성",
    answer: "업무 규칙마다 단위 테스트를 두었다. 결과는 테스트 보고서에 있다.",
    evidence: [doc("테스트 보고서", "docs/test-report.html"), doc("최종 보고서 6장", F + "#testing")] },
  { id: "E-5", group: "eval", title: "보고서의 충실도", quote: "보고서의 충실도",
    answer: "모든 필수 항목을 갖춘 최종 보고서.", evidence: [pdf("최종 보고서 PDF", "docs/final-report.pdf")] },
];
