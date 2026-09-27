import { GROUPS, ITEMS, TODAY } from "./data.js";

const view = document.getElementById("view");
const KIND = { doc: "문서", pdf: "파일", img: "다이어그램", app: "앱", ext: "외부 링크" };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const md = (d) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : "");

function facts() {
  const done = ITEMS.filter((i) => !i.todo).length;
  document.getElementById("facts").innerHTML =
    `과제 요구사항 <b>${ITEMS.length}</b>개 중 <b>${done}</b>개 완료 · 유스케이스 <b>13</b> · 테이블 <b>11</b> · 업무 규칙 <b>14</b> · 테스트 <b>전부 통과</b>`;
}

function listView() {
  const deadlines = GROUPS.filter((g) => g.due && g.id !== "talk");
  const rail = deadlines.map((g) => {
    const past = g.due <= TODAY;
    return `<li class="${past ? "past" : ""}"><a href="#${g.id}"><span class="wk">W${g.week}</span><span class="dt">${md(g.due)}</span><span class="lb">${esc(g.label)}</span></a></li>`;
  });
  // "오늘" 표시는 지난 마감과 다음 마감 사이에 끼운다.
  const next = deadlines.findIndex((g) => g.due > TODAY);
  if (next >= 0) rail.splice(next, 0, `<li class="today" aria-label="오늘 ${TODAY}"><span>오늘 ${md(TODAY)}</span></li>`);

  const sections = GROUPS.map((g) => {
    const rows = ITEMS.filter((i) => i.group === g.id).map((i) => `
      <li><a class="row" href="#/r/${i.id}">
        <span class="rid">${i.id}</span>
        <span class="rt">${esc(i.title)}</span>
        <span class="rk">${[...new Set(i.evidence.map((e) => KIND[e.kind]))].join(" · ")}</span>
        <span class="st ${i.todo ? "todo" : "ok"}">${i.todo ? "팀 확인 필요" : "완료"}</span>
      </a></li>`).join("");
    const when = g.due ? `<span class="due">${g.week}주차 · ${g.due}</span>` : "";
    return `<section class="group" id="${g.id}"><header><h2>${esc(g.label)}</h2>${when}<p>${esc(g.note)}</p></header><ol class="rows">${rows}</ol></section>`;
  }).join("");

  view.innerHTML = `<div class="board"><nav class="rail" aria-label="마감 주차"><ol>${rail.join("")}</ol></nav><div class="groups">${sections}</div></div>`;
}

function preview(e) {
  if (e.kind === "img") return `<figure class="pv-img"><img src="${e.href}" alt="${esc(e.label)}"></figure>`;
  if (e.kind === "doc" || e.kind === "app") return `<iframe class="pv-frame ${e.kind}" src="${e.href}" title="${esc(e.label)}"></iframe>`;
  return `<div class="pv-none"><p>이 결과물은 미리보기 대신 새 창에서 엽니다.</p><a class="btn primary" href="${e.href}" target="_blank" rel="noopener">${esc(e.label)} 열기</a></div>`;
}

function detailView(id, tab = 0) {
  const i = ITEMS.find((x) => x.id === id);
  if (!i) return listView();
  const g = GROUPS.find((x) => x.id === i.group);
  const idx = ITEMS.indexOf(i);
  const prev = ITEMS[idx - 1], next = ITEMS[idx + 1];
  const e = i.evidence[Math.min(tab, i.evidence.length - 1)];
  const tabs = i.evidence.map((ev, k) =>
    `<li><a href="#/r/${i.id}/${k}" class="${ev === e ? "on" : ""}" ${ev === e ? 'aria-current="true"' : ""}><span class="kind">${KIND[ev.kind]}</span>${esc(ev.label)}</a></li>`).join("");

  view.innerHTML = `
  <article class="detail">
    <nav class="crumbs"><a href="#${g.id}">전체 목록</a><span>${esc(g.label)}${g.due ? ` · ${g.week}주차` : ""}</span></nav>
    <header class="dh">
      <span class="rid big">${i.id}</span>
      <h2>${esc(i.title)}</h2>
    </header>
    <div class="dgrid">
      <div class="dtext">
        <h3>과제 설명서 원문</h3>
        <blockquote>${esc(i.quote)}</blockquote>
        <h3>우리 결과물</h3>
        <p>${esc(i.answer)}</p>
        ${i.todo ? `<p class="todo-note">${esc(i.todo)}</p>` : ""}
        <h3>결과물 위치</h3>
        <ol class="tabs">${tabs}</ol>
        <p class="open"><a href="${e.href}" target="_blank" rel="noopener">선택한 결과물 새 창에서 열기</a></p>
      </div>
      <div class="dpreview">${preview(e)}</div>
    </div>
    <nav class="pager">
      ${prev ? `<a href="#/r/${prev.id}"><span>이전</span>${prev.id} ${esc(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a href="#/r/${next.id}" class="nx"><span>다음</span>${next.id} ${esc(next.title)}</a>` : "<span></span>"}
    </nav>
  </article>`;
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function route() {
  const m = location.hash.match(/^#\/r\/([^/]+)(?:\/(\d+))?/);
  if (m) return detailView(decodeURIComponent(m[1]), Number(m[2] || 0));
  const onList = view.querySelector(".board");
  if (!onList) listView();
  const g = location.hash.slice(1);
  if (g) document.getElementById(g)?.scrollIntoView({ block: "start" });
}

facts();
window.addEventListener("hashchange", route);
route();
