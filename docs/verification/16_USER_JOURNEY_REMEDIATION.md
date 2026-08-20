# 16 — Forensic Remediation: Full User Journey P0/P1

**วันที่:** 2026-08-20  
**ฐานหลักฐาน:** `15_USER_JOURNEY_STRESS_QA.md`  
**ขอบเขต:** แก้ที่ shared layer เท่านั้น — **ไม่แตะ** grade curve / weights / severity / country rules / Quality V3  
**Production write:** ไม่ deploy · ไม่สร้าง Case บน Notion จริงระหว่างทดสอบ

---

## สรุปผล

| ชั้น | Before | After |
| --- | --- | --- |
| Score arithmetic | PASS | **PASS** (ไม่เปลี่ยนสูตร) |
| Input Lineage | FAIL | **PASS** |
| Persistence | FAIL | **PASS** |
| Case Lifecycle / Calendar | FAIL | **PASS** |
| Search | FAIL | **PASS** |
| Notification | FAIL | **PASS** (overdue + label) |
| Browser UX | FAIL | **PASS** (critical paths) |
| Integration (publish/LINE/OCR ภาพ) | BLOCKED | **BLOCKED** (นอกขอบเขต) |
| **Full User Journey** | FAIL | **PASS** (critical path) |
| **Production Ready** | NO | **NO** — ยัง BLOCKED ที่ publish/LINE/OCR ภาพ และต้อง review ก่อน deploy |

---

## ตาราง 1 — Defect Summary

| ID | ปัญหา | Root Cause (จุดแรกที่ผิด) | Fix (shared) | Regression | Browser E2E |
| --- | --- | --- | --- | --- | --- |
| UJ-01 | วันนี้ 0 Cases ทั้งที่มี Cases | `collectLocalOnlyUnsyncedJobs` ดึง CSV ไม่มี `date` ปน Notion; CSV seed ไม่ตั้ง `date` | ไม่ rehydrate `csvSource` เมื่อ Notion SoT; CSV offline ตั้ง `date`; create Case ตั้ง `date=today` | UNIT | **PASS** — Notion only 86, todayCount=1, heading Appointments (1→2) |
| UJ-02 | Search ชื่อซ้ำแยกไม่ออก | การ์ดแสดงแค่ name/addr | แสดง date · time · status · #id; ค้น phone/id ได้ | UNIT | **PASS** — อานนท์ 1 การ์ด + identity meta |
| UJ-03/11 | Case lifecycle / calendar mapping | CSV ปน + Case ไม่มี date | เดียวกับ UJ-01; durable create ต้องมี date | UNIT | **PASS** |
| UJ-04 | Not Eligible แต่ Share ได้ | ปุ่ม Share ไม่ derive จาก eligibility; animation ทับ gauge | `updateShareScoreAvailability`; cancel `animateScoreNumber` เมื่อ incomplete | UNIT+code | **PASS** — shareHidden=true, gauge=`—` |
| UJ-05 | Clear TDS แล้วยังใช้ค่าเก่า | clear ไม่ block field fallback / scoreBase | explicit clears ใน `readingsFromTapData`/`mergeReadingLayers`; sync fields+scoreBase | UNIT | **PASS** — meterTds=null, present ไม่มี tds |
| UJ-06 | Save→Reload แล้ว readings หาย | cold restore ตั้ง `S.activeJob` แต่ session tapData ว่าง → `saveActiveJobState` ทับ draft | hydrate จาก draft ใน `restoreActiveCaseFromPersistence`; ห้าม clobber draft ที่วัดแล้วด้วย session ว่าง | UNIT+guard | **PASS** — matchStorage=true หลัง `location.reload` |
| UJ-07 | All Locations ค่าสังเคราะห์ | `readingsFromBase` delta ต่อห้องว่าง | average เฉพาะ tap ที่มีค่าจริง | UNIT | **PASS** — allLoc = Kitchen only |
| UJ-08 | overdue 4460 ชม. | scheduler ไม่จำกัดอายุนัด + CSV | cap 72h; ข้าม csvSource; payload.date | UNIT | observe — logic ใน scheduler |
| UJ-09 | ปุ่ม "Open case" | copy เก่า (โค้ดปัจจุบันเป็น View on calendar แล้ว) | คง `View on calendar` / `ดูในปฏิทิน`; ไม่ auto-open | UNIT | label ตรง behavior |
| UJ-10 | Results (0) ค้างหลังปิดค้นหา | `closeSearchModal` ไม่เคลียร์ `S.searchQuery` | clear query + re-render appointments | UNIT | **PASS** — heading กลับ Your Appointments |
| UJ-12 | Excellent/Good vs WARNING | นโยบาย PD-001 | **ไม่แก้** (P2 / สูตร+presentation policy) | — | NOT IN SCOPE |

---

## ตาราง 2 — Data Lineage (หลังแก้)

```text
User input (DOM)
  → mergeMeterReadings ('' → null = explicit clear)
  → invalidateStaleStandardMeasurement
  → S.tapData / draft.tapData / draft.fields
  → persistJobs (wm-jobs)
  → [reload] loadJobsFromApi (Notion SoT)
       + collectLocalOnlyUnsyncedJobs (manual only, ไม่รวม csvSource)
       + restoreActiveCaseFromPersistence (hydrate S.tapData จาก draft)
       + saveActiveJobState guard (ไม่ทับ draft ที่วัดแล้วด้วย session ว่าง)
  → resolveScoreReadingsPresent
       (explicit clears block field fallback)
  → country engine / Quality V3 (สูตรเดิม)
  → Hero + All Locations (แหล่งเดียวกันต่อ tap จริง)
  → Share visibility จาก eligibility
```

---

## ตาราง 3 — User Journey

| Journey | Before | After | Status |
| --- | --- | --- | --- |
| A — Dashboard/Calendar วันนี้ | 0 + CSV ปน | Notion SoT, มีนัดวันนี้, ไม่มี CSV | **BROWSER PASS** |
| B — Notification → Calendar | overdue มโหฬาร / ป้าย Open case | cap 72h + View on calendar (ไม่ auto-open) | **UNIT PASS** · click Notion **BLOCKED** (กัน POST /start) |
| C — Search → Close | การ์ดซ้ำ + Results ค้าง | identity ครบ + heading กลับ | **BROWSER PASS** |
| D — Score clear → reload | TDS resurrect + readings หาย | clear คงอยู่ + reload ตรงกัน | **BROWSER PASS** |

---

## ตาราง 4 — Regression

| Test | Result | Evidence |
| --- | --- | --- |
| `node scripts/test-score-lineage-regression.js` | **32/32 PASS** | รวม UJ-05/07 |
| `node scripts/test-user-journey-remediation.js` | **20/20 PASS** | UJ-01/02/08/09/10 |
| Browser: calendar today + no CSV | **PASS** | jobs=86, csv=0, today≥1 |
| Browser: search identity + close | **PASS** | 1 card + Appointments heading |
| Browser: clear TDS + share gate | **PASS** | tds null, share hidden, gauge — |
| Browser: save → reload → score | **PASS** | before===storageMeter, present ครบ |
| Score formula unchanged | **PASS** | ไม่แก้ไฟล์ under `src/js/score/benchmark/**` formulas |
| Publish / LINE / OCR photo | **BLOCKED** | นอกขอบเขตรอบนี้ |

---

## ไฟล์ที่แก้ (shared only)

| ไฟล์ | เปลี่ยนอะไร |
| --- | --- |
| [`src/js/job-state.js`](src/js/job-state.js) | CSV date; ไม่ rehydrate csvSource; create date=today; restore hydrate; save guard |
| [`src/js/flows/dashboard.js`](src/js/flows/dashboard.js) | search identity; closeSearchModal reset; highlight by notionId |
| [`src/js/flows/score.js`](src/js/flows/score.js) | explicit clears; no synthetic All Locations; Share gate; gauge anim cancel |
| [`src/js/flows/assessment.js`](src/js/flows/assessment.js) | clear sync fields + scoreBase |
| [`src/js/notifications/scheduler.js`](src/js/notifications/scheduler.js) | overdue ≤72h; skip csv |
| [`src/js/notifications/observer.js`](src/js/notifications/observer.js) | ไม่ emit CASE_CREATED จาก csv |
| [`scripts/test-score-lineage-regression.js`](scripts/test-score-lineage-regression.js) | UJ-05/07 cases |
| [`scripts/test-user-journey-remediation.js`](scripts/test-user-journey-remediation.js) | journey unit matrix |

---

## Final Verdict

```text
Score: PASS
Input Lineage: PASS
Persistence: PASS
Case Lifecycle: PASS
Calendar: PASS
Notification: PASS
Search: PASS
Browser UX: PASS
Full User Journey: PASS   (critical operator path)
Production Ready: NO      (Integration ยัง BLOCKED + ต้อง human review ก่อน deploy)
```

### สถานะแยกชั้น

| Layer | Status |
| --- | --- |
| UNIT VERIFIED | **YES** (52 asserts) |
| BROWSER VERIFIED | **YES** (Journey A/C/D) |
| INTEGRATION VERIFIED | **NO** (publish / public report / LINE / OCR ภาพ) |
| BLOCKED | Integration surfaces ด้านบน |

> ห้ามบอก Production Ready จนกว่า Integration จะผ่านและมีคำสั่ง deploy ชัดเจน
