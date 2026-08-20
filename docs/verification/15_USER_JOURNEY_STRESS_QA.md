# 15 — User Simulation QA: Real User Journey Stress Test

**วันที่:** 2026-08-20 (~14:20 ICT)  
**มุม:** เจ้าหน้าที่ภาคสนาม ไม่ใช่ developer  
**สภาพแวดล้อม:** `http://127.0.0.1:3177/` · ล็อกอิน Local Dev  
**Production write:** **ห้าม** — ไม่กด Create, ไม่เปิดเคสที่มี `notionId`, ไม่ publish, ไม่ Retry LINE  
**ไม่แก้โค้ด / ไม่แก้สูตร / ไม่ patch test**

คำถามของรอบนี้: **ถ้าคนจริงใช้ระบบตั้งแต่เข้าแอปจนจบงาน ข้อมูลและหน้าจอยังถูกที่ทุกครั้งหรือไม่?**  
(สูตรคะแนนพิสูจน์แล้วในรายงาน 14 — รอบนี้ไม่ใช่รอบพิสูจน์เลขคณิต)

---

## คำตัดสินแยกชั้น

| ชั้น | ผล |
| --- | --- |
| Score Arithmetic | **PASS** (อ้างรายงาน 14 เมื่ออินพุตถึง engine) |
| Input Lineage | **FAIL** |
| Case Lifecycle | **FAIL** |
| Persistence | **FAIL** |
| Calendar | **FAIL** |
| Notification | **FAIL** |
| Browser UX | **FAIL** |
| Integration | **BLOCKED** (publish / public report / card / LINE / OCR ภาพ / สร้าง Case บน Notion) |
| **Full User Journey** | **FAIL** |

---

## PART 2 — User Scenario Matrix

| ID | Category | Scenario | วิธีรันรอบนี้ | ผล |
| --- | --- | --- | --- | --- |
| US-01 | Normal | Case ข้อมูลครบ | กรอก CSV `1001` ในรอบ score ก่อนหน้า | PASS คะแนน / FAIL persist |
| US-02 | Ideal | ค่าดีทั้งหมด | TC-001 | PASS คะแนน |
| US-03 | Borderline | ใกล้ขอบ | TC-004/005 | PASS คะแนน |
| US-04 | Warning | พารามิเตอร์เริ่มผิด | TC-008 | PASS คะแนน / UX ป้ายขัด |
| US-05 | Critical | พารามิเตอร์วิกฤต | TC-010 | PASS คะแนน / UX Good+CRITICAL |
| US-06 | Missing | ช่องหาย | TC-014/015 | PASS ขาด Cl / **FAIL ลบ TDS** |
| US-07 | Partial | กรอกบางตัว | Score หลัง reload → Not Eligible | FAIL persist |
| US-08 | No Chlorine | ไม่มีคลอรีน | ลบ Cl ผ่าน UI | PASS |
| US-09 | Invalid | ไม่ใช่ตัวเลข | พิมพ์ abc ในช่อง number | ช่องปฏิเสธ |
| US-10 | Zero | ค่า 0 | TC-017 pH 0 | PASS คำนวณเป็นค่าวัด |
| US-11 | Blank | ช่องว่าง | ลบ TDS | **FAIL resurrect** |
| US-12 | Whitespace | `" "` | ช่อง number กลายเป็นว่าง | ค่าเก่าไม่หาย |
| US-13 | OCR correct | OCR ถูก | ต้องถ่ายรูป | **BLOCKED** |
| US-14 | OCR wrong | OCR ผิด | ต้องถ่ายรูป | **BLOCKED** |
| US-15 | OCR → manual | แก้ทับ | ต้องถ่ายรูป | **BLOCKED** |
| US-16 | Manual clear | ลบค่าที่เคยมี | TDS / Cl | FAIL TDS / PASS Cl |
| US-17 | Save → reload | บันทึกแล้วรีเฟรช | `location.reload` + เปิดเคส | **FAIL ค่าว่าง** |
| US-18 | Case switching | A→B→A | ไม่เปิดเคส Notion | **NOT RUN** (เสี่ยง POST `/start`) |
| US-19 | Multiple same day | หลายเคสวันเดียว | 19 ส.ค. มี 5 เคสในคลัง | เห็นในข้อมูล / **ไม่ได้คลิกการ์ด** |
| US-20 | Different days | กระจายหลายวัน | dateMin 2026-01-10 … dateMax 2026-09-01 | ปฏิทินวันนี้ว่าง |
| US-21 | Old case | วันที่เก่า | อานนท์ overdue 4460 ชม. | FAIL UX overdue |
| US-22 | Future case | วันที่อนาคต | มีเคสถึง 2026-09-01 | **NOT RUN** เปิด |
| US-23 | Notification | เคสใหม่เกิด noti | กระดิ่ง 44 รายการ, มี New C. | FAIL ปริมาณ/ป้าย |
| US-24 | Notif + many cases | ไปวันที่มีหลายเคส | ปุ่มชื่อ Open case | **NOT RUN** คลิก (เสี่ยงเปิดเคสจริง) |
| US-25 | Deleted/missing case | noti อ้างเคสที่ไม่มี | ไม่ได้สร้างเคสปลอม | **NOT RUN** |
| US-26 | Rapid interaction | กดรัว | ไม่ได้ | **NOT RUN** |
| US-27 | Refresh กลางทาง | รีเฟรชตอนกรอก | reload หลัง score | FAIL |
| US-28 | Back navigation | ปุ่มกลับ | Score→Assess→Hub→Dash | PASS ทางกลับ |
| US-29 | Incomplete → complete | เติมทีหลัง | ถูกบล็อกโดย persist | FAIL |
| US-30 | Country switch | 5 ประเทศ | รายงาน 14 | PASS readings ไม่เปลี่ยน |
| US-31 | Score display | Hero / All locations | Not Eligible + Share ยังอยู่ | FAIL UX |
| US-32 | Publish | หลังคะแนนพร้อม | กฎห้าม production | **BLOCKED** |
| US-33 | Public report | URL สาธารณะ | ห้าม | **BLOCKED** |
| US-34 | Card | score card | ห้าม | **BLOCKED** |
| US-35 | LINE | ส่งผล | Retry ในกระดิ่งไม่กด | **BLOCKED** |
| US-36 | Case create | กด + สร้างเคส | `POST /api/cases` → Notion | **BLOCKED** |
| US-37 | Search duplicate | หาชื่อเดิม | ค้น อานนท์ | **FAIL** การ์ดซ้ำไม่แยกตัวตน |
| US-38 | Search leftover | ปิดค้นหา | หัวข้อค้าง Results (0) | **FAIL** |

---

## PART 3 — Case Creation QA

**ไม่กดปุ่ม Create (+)** เพราะ `createManualCase` เรียก `POST /api/cases` แล้วต้องได้ `notionId` ก่อนจึงถือว่าสร้างสำเร็จ — บนเซิร์ฟเวอร์นี้โหลด Notion จริง (85 เคสจาก production)

| Check | Expected | Actual | ผล |
| --- | --- | --- | --- |
| สร้าง Case แบบเจ้าหน้าที่ | ได้เคสในปฏิทินวันนี้ | ห้ามยิง production | **BLOCKED** |
| CSV seed 30 เคส | ปรากฏในปฏิทินเพื่อเปิดงาน | **ไม่มี `date` → ปฏิทินวันนี้ 0** | **FAIL** |
| Durable ID | แยก CSV กับ Notion | ค้น อานนท์ ได้ **2 การ์ดหน้าตาเดียวกัน** ไม่มี ID/วันที่ | **FAIL** |
| Duplicate create | ไม่ซ้ำ | คลังมีทั้ง CSV `1001` และเคส Notion ชื่อเดียวกัน | **FAIL** (ข้อมูลปน) |
| Reload แล้วยังหาเคสได้ | เคสไม่หาย | เคส CSV ยังอยู่ใน JOBS แต่ **หาจากปฏิทินวันนี้ไม่ได้** | FAIL สำหรับผู้ใช้ |

ผู้ใช้ที่ทำตาม hint “Tap + to start one on-site” จะสร้างเคสบน Notion จริง

---

## PART 4 — User Journey ที่ทำผ่าน UI จริง

```text
อยู่หน้า Water Score (ค้างจากรอบก่อน)
 → Back → Water Assessment
 → Back → Job hub (อานนท์ ศ. 09:00–10:00)
 → Back → Dashboard 20 Aug Your Appointments (0)
 → Search “อานนท์” → การ์ดซ้ำ 2 ใบ
 → Close search → หัวข้อค้าง Results (0)
 → กระดิ่ง → 44 รายการ, ปุ่ม Open case, overdue 4460 ชม.
```

**ไม่ได้กด:** Create, Open case, Retry LINE, Share Score, Cancel job

---

## Evidence ที่ผู้ใช้เห็น (runtime)

### UJ-01 — ปฏิทินวันนี้ไม่มีงาน ทั้งที่มีเคสในเครื่อง

- 20 Aug 2026: **Your Appointments (0)** + “Tap + to start one on-site”
- JOBS = 115 (30 CSV ไม่มีวันที่ + 85 Notion)
- วันนี้ `todayCount = 0`
- CSV `1001` อานนท์ เปิดจากรอบก่อนได้ แต่ **ไม่ได้อยู่ในรายการวันนี้**

**Expected:** เจ้าหน้าที่เห็นเคสที่ต้องทำ หรืออย่างน้อยเคสที่กำลังทำ  
**Actual:** หน้าแรกว่าง ชวนสร้างเคสใหม่  
**Repro:** 2/2 (เข้า dashboard วันนี้)  
**Severity:** P0  
**Area:** Calendar / Case lifecycle  
**Root cause:** `jobMatchesDate` ใช้แต่วันนัด Notion; CSV ไม่มี `date`

### UJ-02 — ค้นชื่อลูกค้าได้การ์ดซ้ำ ไม่มีตัวแยก

ค้น `อานนท์` → การ์ดสองใบข้อความเดียวกัน “อานนท์ ศ. / ปทุมธานี” ไม่มีวันที่ ไม่มีรหัสเคส  
พื้นหลังยังขึ้น **Results (0) / No matches found** ทั้งที่โมดัลมีผลลัพธ์

**Expected:** แยกเคสชัด (วันที่, แพ็กเกจ, ID) และตัวนับตรง  
**Actual:** ผู้ใช้อาจเปิดคนละเคสโดยไม่รู้  
**Repro:** 1/1  
**Severity:** P0  
**Area:** Case identity / Search UX

### UJ-03 — ปิดค้นหาแล้วหัวข้อปฏิทินไม่กลับ

หลัง Close: หัวข้อยังเป็น **Results (0)** และ “No matches found” ทับข้อความนัดหมาย

**Expected:** กลับเป็น Your Appointments (n)  
**Actual:** state ค้างจากโหมดค้นหา  
**Repro:** 1/1  
**Severity:** P1  
**Area:** State / Navigation

### UJ-04 — หลัง reload คะแนนเป็น Not Eligible แต่ Share ยังกดได้

หน้า Water Score: ป้ายส้ม **Not Eligible**, ขาด ph/tds/orp/do/chlorine/turbidity, แถวเป็น skeleton — ปุ่ม **Share Score** ยังอยู่

**Expected:** ไม่ให้แชร์คะแนนที่ยังไม่มี  
**Actual:** ผู้ใช้อาจแชร์รายงานว่าง  
**Repro:** 1/1 รอบนี้ + รายงาน 14 reload  
**Severity:** P0  
**Area:** Score display / Persistence

### UJ-05 — ลบค่า meter แล้วคะแนนยังคิดจากค่าเก่า

ช่อง TDS ว่างหลัง Complete แต่ persist ยัง `"80"` Hero ยัง 99  
ลบคลอรีนแล้วได้ 79 ตามจริง

**Expected:** ค่าที่ลบต้องหายและไม่คิดคะแนน  
**Actual:** meter ลบไม่ได้, chlorine ลบได้  
**Repro:** 2/2 (รายงาน 13/14 + รอบนี้ใช้หลักฐานเดิมที่ยืนยันแล้ว)  
**Severity:** P0  
**Area:** Data lineage / Assessment

### UJ-06 — Reload แล้วค่าที่กรอกหายจากเคส

ก่อน reload TH=91 หลัง reload `wm-jobs` ก๊อกว่าง Not Eligible

**Expected:** บันทึกแล้วรีเฟรชแล้วยังอยู่  
**Actual:** งานที่กรอกหายจากมุมผู้ใช้  
**Repro:** 1/1  
**Severity:** P0  
**Area:** Persistence

### UJ-07 — ตาราง All locations ไม่ใช่ค่าที่วัด

วัด Kitchen 7.2 / 80 แต่ตารางโหมดทุกห้องแสดง 7.3 / 97 (ค่าสังเคราะห์ก๊อกอื่น)

**Expected:** ตัวเลขบนจอ = ค่าที่วัด  
**Actual:** Hero ถูก ตารางทำให้เข้าใจผิด  
**Repro:** หลายเคสในรายงาน 13/14  
**Severity:** P0  
**Area:** Score display / UX

### UJ-08 — กระดิ่ง: overdue มโหฬาร + ปุ่ม Open case + New C.

- Badge **44** unread  
- “Appointment overdue / อานนท์ ศ. / **4460 hour(s) overdue**”  
- “New case / Customer: New C. / Essential / 09:00”  
- ปุ่มทุกใบชื่อ **Open case** ทั้งที่โค้ดนำทางไปปฏิทิน (ไม่ควร auto-open) — **ป้ายกับพฤติกรรมไม่ตรง** ถ้ากดแล้วเปิดเคสจริงจะยิง `POST /api/cases/:id/start`

**Expected:** overdue สมเหตุสมผล; ปุ่มสื่อว่าไปปฏิทิน; ไม่มีเคส “New C.” หลอก  
**Actual:** ผู้ใช้เห็นงานค้างนับพันชั่วโมงและปุ่มที่ชวนเปิดเคส  
**Repro:** 1/1  
**Severity:** P1  
**Area:** Notification / UX  
**ไม่ได้กด Open case** เพื่อกันเขียน production

### UJ-09 — ป้ายคะแนนทำให้เข้าใจผิดแม้เลขถูก

ญี่ปุ่น Hero 85 + Excellent ทั้งที่ pH WARNING  
ไทย Hero 60 + Good ทั้งที่คลอรีน CRITICAL

**Severity:** P2 (นโยบาย PD-001) แต่ผู้ใช้จริงเข้าใจผิดได้  
**Area:** Score UX

---

## PART 8 — Notification (ทำได้เท่าที่ปลอดภัย)

ออกแบบ `navigateToCalendarDate` = ไปวันในปฏิทิน **ไม่ auto-open** — สอดคล้องกติกา  
แต่ปุ่ม UI เขียนว่า **Open case** → ผู้ใช้คาดว่าจะเปิดเคส

ไม่ได้คลิกเพราะเคสในรายการเป็น Notion / overdue ของลูกค้าจริง

สร้าง 08:00/10:00/14:00 ในวันเดียวกัน = **BLOCKED** (ต้อง POST Notion)

---

## PART 10 — Score cross-check (ไม่เรียก PASS ถ้า lineage ผิด)

| Case | Input ที่ user เห็น | Independent TH | UI TH | Diff | ผล |
| --- | --- | ---: | ---: | ---: | --- |
| TC-001 กรอกครบ | ตรงที่พิมพ์ | 99 | 99 | 0 | PASS |
| DEL-TDS | ช่องว่าง | null | 99 | — | **FAIL — LINEAGE MISMATCH** |
| R-TC-003 หลัง reload | ช่องว่าง / Reading… | 91 | Not Eligible | — | **FAIL persistence** |

---

## PART 11 — UX ที่ไม่ใช่เลขผิด

- วันในปฏิทิน **ไม่เป็นปุ่มใน accessibility tree** (กดผ่านเครื่องมือช่วยเหลือยาก)
- Hint ชวนกด + ทั้งที่เครื่องมี 115 เคส
- Share บน Not Eligible
- ค้นหาซ้ำไม่แยกตัวตน
- หัวข้อ Results ค้าง
- ปุ่ม Open case vs นำทางปฏิทิน
- overdue 4460 ชั่วโมง
- Full Assessment ล็อก Upgrade ทั้งที่เป็นเคส Essential (ตามแพ็กเกจ — อาจทำให้สับสน)

---

## PART 12 — Chaos

| พฤติกรรม | ผลรอบนี้ |
| --- | --- |
| กด Create ซ้ำ | **NOT RUN** (ห้ามสร้าง Notion) |
| Reload หลังกรอก | FAIL ค่าหาย |
| กลับหน้าเร็ว | Back ทำงาน |
| เปิดค้นหาแล้วปิด | state ค้าง |
| ลบค่าแล้วไม่ save | ไม่ได้แยกเคสในรอบนี้ |
| whitespace / 0 / abc | ดู UJ-05 / US-09/10/12 |

---

## PART 15 — สรุปหมวด

| Category | Cases | PASS | FAIL | BLOCKED | NOT RUN |
| --- | ---: | ---: | ---: | ---: | ---: |
| Case Creation | 4 | 0 | 2 | 1 | 1 |
| Calendar | 4 | 0 | 3 | 0 | 1 |
| Assessment | 6 | 2 | 2 | 0 | 2 |
| OCR | 3 | 0 | 0 | 3 | 0 |
| Input Lineage | 5 | 2 | 3 | 0 | 0 |
| Score | 8 | 5 | 3 | 0 | 0 |
| Persistence | 3 | 0 | 2 | 0 | 1 |
| Reload | 3 | 0 | 2 | 0 | 1 |
| Case Switching | 4 | 0 | 0 | 0 | 4 |
| Notification | 5 | 0 | 2 | 1 | 2 |
| Publish | 1 | 0 | 0 | 1 | 0 |
| Report | 1 | 0 | 0 | 1 | 0 |
| Card | 1 | 0 | 0 | 1 | 0 |
| LINE | 1 | 0 | 0 | 1 | 0 |
| **Overall** | **49** | **9** | **21** | **9** | **10** |

ตัวเลข Overall นับ scenario matrix ไม่ใช่ unit test

### Defect table

| ID | Severity | Area | Scenario | Expected | Actual | Repro | Root Cause | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UJ-01 | P0 | Calendar | เปิดแอปวันนี้ | เห็นงานที่ต้องทำ | Appointments (0) | 2/2 | CSV ไม่มี date / jobMatchesDate | open |
| UJ-02 | P0 | Identity | ค้นลูกค้า | แยกเคสได้ | การ์ดซ้ำ 2 ใบ | 1/1 | CSV+Notion ชื่อชน ไม่มี ID บนการ์ด | open |
| UJ-04 | P0 | Score/Persist | reload | คะแนนคง | Not Eligible + Share | 1/1 | draft tap ว่างหลัง reload | open |
| UJ-05 | P0 | Lineage | ลบ TDS | missing | ค่า 80 ยังคิด 99 | 2/2 | merge ข้ามช่องว่าง | open |
| UJ-06 | P0 | Persistence | save→reload | คงค่า | หาย | 1/1 | wm-jobs ถูกทับ/ไม่เก็บ | open |
| UJ-07 | P0 | Score UX | All locations | ค่าวัดจริง | ค่าสังเคราะห์ | หลายรอบ | readingsFromBase ต่อก๊อกว่าง | open |
| UJ-03 | P1 | State | ปิดค้นหา | หัวข้อกลับ | Results (0) ค้าง | 1/1 | filter state ไม่รีเซ็ต | open |
| UJ-08 | P1 | Notification | กระดิ่ง | ป้ายตรงงานจริง | 4460h overdue, Open case, New C., 44 unread | 1/1 | overdue จากเคสเก่า/CSV; copy ปุ่ม | open |
| UJ-09 | P2 | Score UX | ป้าย Hero | สื่อความเสี่ยง | Excellent/Good ทับ WARNING/CRITICAL | รายงาน 14 | PD-001 ใช้เลขอย่างเดียว | open |

---

## ถ้าให้ผู้ใช้จริงเล่นตอนนี้ จะติดตรงไหน

### P0 — ข้อมูล/คะแนนผิด / หาเคสไม่เจอ

1. เข้าแอปวันนี้แล้ว **ไม่มีนัด** ทั้งที่มีเคสในเครื่อง → กด + จะสร้างเคส Notion จริง  
2. ค้นลูกค้าแล้วได้ **สองใบหน้าตาเดียวกัน**  
3. กรอกแล้ว **รีเฟรช งานหาย / Not Eligible**  
4. **ลบค่า meter ไม่หาย** คะแนนยังเต็ม  
5. ตารางใต้คะแนน **ไม่ใช่ค่าที่วัด**  
6. แชร์คะแนนได้ทั้งที่ยังไม่มีค่า  

### P1 — ทำงานต่อไม่ได้ / นำทางผิด / state ผิด

7. ปิดค้นหาแล้วหน้าปฏิทินยังโหมด Results (0)  
8. กระดิ่งเต็มไปด้วย overdue นับพันชั่วโมง และปุ่มชื่อ Open case  

### P2 — UX

9. ป้าย Excellent/Good ไม่สื่อ WARNING/CRITICAL ของพารามิเตอร์  

**Integration (publish / report / card / LINE / OCR / สร้างเคสใหม่) = BLOCKED** ในรอบนี้โดยกติกา production

ไม่มีการแก้ซอร์สระหว่าง execution
