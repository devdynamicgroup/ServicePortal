# 07 — System Review Workbook (สมุดทบทวนระบบ)

**โหมด:** วิเคราะห์อย่างเดียว — ไม่แก้โค้ด ไม่สร้างแพตช์ ไม่เปิดแฟล็ก ไม่เสนอวิธีแก้  
**ผู้อ่าน:** วิศวกรที่เตรียม Manual QA  
**แหล่งข้อมูล:** โค้ดจริง + `docs/verification/01`–`06`  
**วันที่:** 2026-08-05  

> เอกสารนี้เป็นฉบับภาษาไทยของสมุดทบทวนระบบ  
> รายละเอียดเพิ่มเติม: walkthrough `06`, แผนภาพ `01`, QA matrix `04`

---

## ตาราง 1 — ภาพรวมโดเมน

| โดเมน | วัตถุประสงค์ | เจ้าของข้อมูล | อ่านได้ | เขียนได้ | พึ่งพา | แฟล็ก Runtime |
|--------|--------------|---------------|---------|----------|--------|----------------|
| Case | SSOT ฝั่งปฏิบัติการของงานหนึ่งเคส | ฟิลด์จอง, สถานะ workflow, ลิงก์ offer, Case LINE, `notificationStatus`, token, คะแนน | Offer, Care eligibility, report/feedback, Customer linker | Booking, Workflow, Notion clients | Notion Cases DB | เปิดเสมอ |
| Customer | ตัวตนข้าม Case | `customerId`, โทร/อีเมล/LINE, `consentLine` | Dual-write, line-reader, notify-reader, Care dest (ถ้า READ_NOTIFY) | repository ผ่าน resolver/creator/linker/merge/reconcile | Notion Customers DB; migration | `CUSTOMER_DOMAIN_*` (ค่าเริ่ม OFF) |
| Booking | รับจอง → สร้าง Case | ท่อสร้าง Case (ไม่มี DB ของตัวเอง) | กติกา Offer/แคมเปญ | สร้าง Case; เรียก dual-write | validation, Notion, dual-write | DW ต้องมีแฟล็ก Customer |
| Offer | ความจุช่องแคมเปญ | ค่า used/remaining ที่คำนวณได้ | Public API, booking | ไม่เขียนตรง (สร้าง/ยกเลิก Case กระทบนับ) | Notion Cases | เปิดเสมอ |
| Workflow | จัดลำดับงานหลังสร้าง Case | การเปลี่ยนสถานะ + ส่งผลตรวจ | Case, Feedback, notify-reader, LINE | Case, Feedback, dual-write ตอนลิงก์ | Notion, LINE, Customer readers | จุดหมายแจ้ง: `READ_NOTIFY*` |
| Report | ฉาย Case สาธารณะ | การแสดงผลผ่าน `rpt-*` | ลูกค้าสาธารณะ | เนื้อหาบน Case (ผ่าน create/workflow) | Case tokens, url-builder | เปิดเสมอ |
| Feedback | คะแนน/ความเห็นลูกค้า | แถว Feedback DB | API feedback | Feedback DB + สถานะบน Case | Workflow, Notion Feedback | เปิดเสมอ |
| Notification | LINE **ผลงาน** + state machine บน Case | `notificationStatus` / `resultSentAt` + Flex ผลตรวจ | Case LINE ± Customer LINE | เฉพาะฟิลด์ notify ของ Case | Workflow, `line-notifications` | จุดหมาย: แฟล็กอ่าน Customer |
| Care | วงจร care / นัดตรวจซ้ำ | CareAuditEvent, outcomes, CDR (เอกสาร) | ประวัติ Case; Customer LINE ได้ถ้าเปิดแฟล็ก | ไฟล์ Care audit (± Notion Care Audits); LINE care | eligibility, sender, LINE push | `CARE_*` (ค่าเริ่ม OFF) |

---

## ตาราง 2 — ภาพรวม API

| Endpoint | Method | วัตถุประสงค์ | เรียกโดย | บริการหลัก | ฐานข้อมูล | หมายเหตุ |
|----------|--------|--------------|----------|------------|-----------|----------|
| `/api/cases` | POST | สร้าง Case | Framer / SPA / API | case-creation-service | Cases | มี dual-write ถ้าเปิดแฟล็ก |
| `/api/cases/:id/start` | POST | เริ่มงาน | Tech SPA | workflow-service | Cases | |
| `/api/cases/:id/close` | POST | ปิดงาน | Tech SPA | workflow-service | Cases | อาจนำไปสู่การแจ้งผล |
| `/api/cases/:id/cancel` | POST | ยกเลิกนัด | Tech / API | case-creation-service | Cases | คืนช่อง offer |
| `/api/cases/:id/send-result` | POST | ส่ง LINE ผลตรวจ | Tech SPA | workflow-service | Cases + LINE | Case notify SM |
| `/api/cases/:id/score` | POST | บันทึกคะแนน | Tech SPA | workflow-service | Cases | |
| `/api/cases/:id/feedback` | POST | ฟีดแบ็กของ Case | Tech / ระบบ | workflow-service | Cases + Feedback | |
| `/api/cases/:id/preassessment` | POST | แบบประเมินก่อนตรวจ | Public/API | case-creation-service | Cases | |
| `/api/cases/repair-notifications` | POST | ซ่อม/กู้ notify | Ops / tech | workflow-service | Cases | Recovery |
| `/api/test/create-case` | POST | สร้าง Case ทดสอบ | Dev/test | case-creation-service | Cases | จำกัดด้วย env ทดสอบ |
| `/api/report/:token` | GET | Report JSON | Public | case-flow | Cases | ยืนยันด้วย token |
| `/r/:token` | GET | หน้า Report HTML | Public | case-flow | Cases | |
| `/api/feedback/:token` | GET/POST | ฟีดแบ็กตาม token | Public | workflow / client-feedback | Feedback + Cases | |
| `/f/:token` | GET | หน้า Feedback HTML | Public | case-flow | Feedback + Cases | |
| `/api/feedback/suggest` | GET/POST | แนะนำข้อความ AI | SPA | feedback-suggest | — | OpenAI ไม่บังคับ |
| `/api/public/water-check-offer` | GET | สถานะช่อง offer | Framer/public | water-check-offer-service | Cases (อ่าน) | แคช ~60 วินาที |
| `/api/public/score-card/:token` | GET | รูป score card | Public | score-share-card | Cases | |
| `/api/public/score-card/demo` | GET | เดโม่ score card | Dev/demo | score-share-card | — | |
| `/api/clients` | GET | รายการ Case/clients | Dashboard/SPA | notion/clients | Cases | |
| `/api/line/webhook` | POST | อีเวนต์ LINE | LINE platform | line-routes → workflow | Cases ± Customer | ตรวจลายเซ็น |
| `/api/line/status` | GET | สถานะตั้งค่า LINE | Ops | line-routes | — | ไม่โชว์ความลับ |
| `/api/ops/health` | GET | Liveness | Ops/platform | ops-routes | — | |
| `/api/ops/readiness` | GET | Readiness + เมตาแฟล็ก | Ops | ops-routes | — | เห็นสถานะแฟล็ก |
| `/api/debug/*` | ต่างๆ | ดีบัก | Dev | clients/case-flow | ตามเส้นทาง | ไม่ใช่ path หลักผลิต |
| Google Drive / Review / OCR | ต่างๆ | ส่วนช่วย SPA | SPA/ops | google-*/ocr | ภายนอก | นอกแกน Case/Care |
| Care CLI (ไม่ใช่ HTTP) | — | สแกน/ส่ง/รายงาน Care | Operator | care-lifecycle | ไฟล์ Care ± Cases | จุดเข้า Care หลัก |

---

## ตาราง 3 — โฟลว์หลัก

| โฟลว์ | จุดเริ่ม | จุดจบ | โมดูลหลัก | เจ้าของ | สถานะ |
|--------|----------|--------|-----------|---------|--------|
| Booking | POST `/api/cases` | ได้ Case | case-creation, notion, dual-write | Case | มีแล้ว; DW ปิดโดยค่าเริ่ม |
| Cancel Booking | POST `.../cancel` | ยกเลิก + คืนช่อง | case-creation, นับ offer | Case / Offer | มีแล้ว |
| Result Notification | send-result / หลังปิดงาน | LINE ผล + `sent`/`failed` | workflow, line-notifications, notify-reader | Case Notification | มีแล้ว |
| Retry | ส่งซ้ำหลังล้มเหลว | `sent` หรือยัง `failed` | workflow | Case Notification | มีแล้ว |
| Recovery | repair-notifications | กู้สถานะ notify | workflow | Case Notification | มีแล้ว |
| Customer Merge | Merge CLI/API | รวมตัวตน | customer-domain/merge | Customer | มีแล้ว; MERGE ปิด |
| Reconcile | reconcile CLI | รายงาน ± ซ่อม | migration/customer-reconcile | Customer | มีแล้ว; ออฟไลน์ |
| Care Dry Run | Care CLI dry-run | ออดิท dry_run/skip | care-lifecycle/run, audit | Care | มีแล้ว; SEND ปิด |
| Care Send | Care CLI send | LINE care + ออดิท | care run, sender, LINE | Care | มีแล้ว; **แฟล็กปิด / Track A ยังไม่เซ็น** |
| Care Outcome | outcome report CLI | `latest-outcome-report.json` | outcomes, outcome-report | Care | มีแล้ว; อ่านอย่างเดียว |
| Track A | หลักฐาน + เอกสารเซ็น | GO/NO-GO โดยคน | เอกสาร M9.6 | Ops | **แพ็กพร้อม; Checkpoint A ยังไม่เซ็น** |

---

## ตาราง 4 — User Cases

| UC | ชื่อ | Actor | Trigger | ผลที่คาดหวัง |
|----|------|-------|---------|----------------|
| UC-01 | สร้าง Case | ลูกค้า/ระบบ | POST `/api/cases` | Case สถานะ `not_sent`; DW ตามแฟล็ก |
| UC-02 | ยกเลิกนัด | Operator | cancel API | ยกเลิก; คืนช่อง offer |
| UC-03 | Preassessment | ลูกค้า | preassessment API | อัปเดตฟิลด์บน Case |
| UC-04 | สถานะ Offer | Public/Framer | GET water-check-offer | JSON ช่องว่าง |
| UC-05 | จองพร้อมแคมเปญ | ลูกค้า | createCase + campaign | นับใน offer ถ้ายัง active |
| UC-06 | ลิงก์ LINE | ลูกค้า/ระบบ | Webhook/ลิงก์ | มี Case LINE; มักเป็น `ready` |
| UC-07 | LINE webhook | ลูกค้า/ระบบ | POST webhook | จัดเส้นทางอีเวนต์; เช็คลายเซ็น |
| UC-08 | Start Case | ช่าง | start API | เดิน workflow |
| UC-09 | Close Case | ช่าง | close API | ปิดงาน |
| UC-10 | ส่งผลตรวจ | ช่าง/ระบบ | send-result | Case `sent`/`failed` + LINE |
| UC-11 | ซ่อม/รีทราย notify | ช่าง/ระบบ | repair/ส่งซ้ำ | กู้สู่ `sent` ได้ |
| UC-12 | ทำเครื่องหมาย failed | ระบบ | ส่งล้มเหลว | เก็บ `failed` |
| UC-13 | ดูรายงานสาธารณะ | Public | `/r/:token` หรือ API | รายงานจาก Case |
| UC-14 | ฟีดแบ็กด้วย token | ลูกค้า | `/f` / feedback API | Feedback DB + สถานะ Case |
| UC-15 | ส่งฟีดแบ็กของ Case | ช่าง/ระบบ | cases/:id/feedback | Case+Feedback สอดคล้อง |
| UC-16 | เผยแพร่คะแนน / card | ช่าง/Public | score + score-card | แอสเซ็ตคะแนน |
| UC-17 | Dual-write หลังสร้าง | ระบบ | หลังสร้าง Case | ลิงก์ Customer ถ้าเปิดแฟล็ก |
| UC-18 | Dual-write หลังลิงก์ LINE | ระบบ | หลัง linkLineUser | ซิงก์ตัวตนถ้าเปิดแฟล็ก |
| UC-19 | อ่านประวัติ LINE | ระบบ | history/latest | Case หรือ Customer ตามแฟล็ก |
| UC-20 | หาปลายทางแจ้งผล | ระบบ | ในผลส่งผลตรวจ | Case LINE เป็นค่าเริ่ม; Case ชนะเมื่อ diverge |
| UC-21 | Merge ด้วยมือ | Steward | merge CLI | รวมแบบ exact / ปฏิเสธถ้าปิดแฟล็ก |
| UC-22 | Reconcile | Operator | reconcile CLI | รายงาน ± ซ่อมตัวตน |
| UC-23 | Care dry-run | Operator | Care CLI dry-run | ออดิท; Case notify ไม่เปลี่ยน |
| UC-24 | Care SEND | Operator | Care CLI send | ส่ง care + ออดิท; ต้องมีแฟล็ก |
| UC-25 | รายงานผลลัพธ์ Care | Operator | outcome CLI | JSON สรุป |
| UC-26 | CDR / ทบทวนนโยบาย | Operator/Reviewer | ทบทวนรายสัปดาห์ | เปลี่ยนได้หลังคนอนุมัติเท่านั้น |
| UC-27 | Rollback Care | On-call | เหตุการณ์ | ปิดแฟล็ก; ไม่ rewrite Case |
| UC-28 | เซ็น Checkpoint A | ทีม Ops 3 บทบาท | ประชุม Track A | GO = อนุญาตให้คนไปเปิดแฟล็กทีหลัง |

---

## ตาราง 5 — ความเป็นเจ้าของข้อมูล

| ข้อมูล | เจ้าของ | อ่านได้ | อัปเดตได้ | ห้ามเปลี่ยนโดย |
|--------|---------|---------|-----------|-----------------|
| ฟิลด์จองบน `case.*` | Case | Workflow, report, Care eligibility | Booking, workflow | Care / Customer มา rewrite งาน |
| `case.customerId` (ลิงก์) | Case เก็บลิงก์; Customer ครอง id | ผู้อ่านทั่วไป | Linker / dual-write | ทับแบบคลุมเครือ |
| Case LINE / `case.line.*` | Case | Notify, Care dest, ประวัติ LINE | linkLineUser / อัปเดต Case | ลบเพราะมี Customer แล้ว |
| `case.notificationStatus` | Case | Workflow, Care สังเกต | Workflow / ค่าเริ่มตอนสร้างเท่านั้น | **Care ห้ามเขียน** |
| `case.resultSentAt` | Case | Workflow, report | Workflow เมื่อส่งสำเร็จ | Care / Customer |
| ฟิลด์แคมเปญ / offer บน Case | Case | Offer service | Booking/สร้าง/ยกเลิก | Offer สร้าง Case ปลอม |
| สถานะ workflow/job | Case | SPA, workflow | Workflow | Care |
| token/สถานะฟีดแบ็กบน Case | Case | โฟลว์ฟีดแบ็ก | สร้าง + workflow | Care |
| report token | Case | Public report | สร้าง/workflow | Care |
| ฟิลด์คะแนนบน Case | Case | Score card, SPA | publishCaseScore | Care |
| `customer.customerId` | Customer | โดเมน, ลิงก์ Case | Creator | Case สุ่มสร้าง id |
| โทร/อีเมลบน Customer | Customer | Matcher, DW | Creator/อัปเดต (มีแฟล็ก) | รวมแบบคลุมเครือ |
| `customer.lineUserId` / LINE | Customer | line-reader, notify-reader | Creator/link (มีแฟล็ก) | เดาจากชื่อ |
| `customer.consentLine` | Customer | Care eligibility, steward | อัปเดตฝั่ง Customer | Care บังคับ true เพื่อส่ง |
| `remainingSlots` (คำนวณ) | Offer service | Public API | ทางอ้อมผ่านชุด Case ที่ active | เก็บเป็นฟิลด์ notify ของ Case |
| เนื้อหา Feedback DB | Feedback | API ฟีดแบ็ก | client-feedback | Case notification SM |
| สถานะ/delivery ของ Care audit | Care | รายงาน outcome, ops | ตัวบันทึก Care audit | `case.notificationStatus` |
| ฟิลด์ outcome ของ Care | Care | รายงาน | เส้นทางวัดผล/tracking | ฟิลด์ผลตรวจของ Case |
| ดัชนี idempotency ของ Care | Care | Care run | Care audit | ลบกลางเหตุการณ์ |
| บันทึก CDR | เอกสารกำกับ Care | Ops | คน | โยนเข้า `events.jsonl` |

---

## ตาราง 6 — แฟล็ก Runtime

| แฟล็ก | ค่าเริ่ม | ขึ้นกับ | ผู้เปิด | Rollback | วัตถุประสงค์ |
|--------|----------|---------|---------|----------|--------------|
| `CUSTOMER_DOMAIN_ENABLED` | false | — | Ops (เกต M8) | false | สวิตช์หลัก Customer Domain |
| `CUSTOMER_DOMAIN_DUAL_WRITE` | false | ENABLED + Customers DB | Ops | false | ซิงก์ Customer หลัง Case/ลิงก์ |
| `CUSTOMER_DOMAIN_READ_LINE` | false | ENABLED | Ops | false | อ่านประวัติ LINE ผ่าน Customer เป็นหลัก |
| `CUSTOMER_DOMAIN_READ_LINE_SHADOW` | false | ENABLED; ถูกละถ้าเปิด READ_LINE | Ops | false | เทียบอย่างเดียว; Case เป็นเจ้าของจริง |
| `CUSTOMER_DOMAIN_READ_NOTIFY` | false | ENABLED | Ops | false | ชอบ Customer LINE เป็นปลายทางแจ้งผล |
| `CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW` | false | ENABLED; ถูกละถ้าเปิด READ_NOTIFY | Ops | false | เทียบ; Case ยังเป็นคนส่ง |
| `CUSTOMER_DOMAIN_MERGE_ENABLED` | false | ENABLED | Steward | false | อนุญาต merge ด้วยมือ |
| `CARE_LIFECYCLE_ENABLED` | false | — | Ops เฟส 1 | false | ให้ประเมิน/dry-run Care |
| `CARE_LIFECYCLE_SEND` | false | ENABLED | Ops หลัง Checkpoint A | **ปิด SEND ก่อน** | ส่ง LINE care จริง |
| `CARE_OUTCOME_TRACKING` | false | — | Ops (ไม่บังคับ) | false | เขียนฟิลด์ outcome กลับ |
| `CARE_OUTCOME_REPORT` | false | — | Ops (ไม่บังคับ) | false | เกตรายงาน (CLI อ่านไฟล์ได้โดยไม่ต้องเปิด) |
| `CARE_REINSPECTION_DAYS` | 182 | — | Ops (เปลี่ยนผ่าน CDR) | ค่าเดิม | หน้าต่าง eligibility (วัน) |
| `NOTION_CARE_AUDITS_DATABASE_ID` | ว่าง | Notion key | Ops (ไม่บังคับ) | ว่าง | DB ออดิท Care แบบถาวร |
| `LINE_MOCK_SEND` | มัก true ใน local | — | Dev/ops | สลับตาม env | ม็อกการส่ง LINE |

---

## ตาราง 7 — ระบบภายนอก

| ระบบ | วัตถุประสงค์ | อ่าน | เขียน | Retry | เมื่อล้มเหลว |
|------|--------------|------|-------|-------|--------------|
| Notion Cases | เก็บ Case SSOT | ได้ | ได้ (บริการ ops) | ตาม caller | คำขอล้ม; ไม่ให้ Care เขียน notify เงียบๆ |
| Notion Customers | เก็บตัวตน | ได้เมื่อมีแฟล็ก | ได้เมื่อมีแฟล็ก | DW best-effort | สร้าง Case ยังสำเร็จได้ |
| Notion Feedback | เนื้อหาฟีดแบ็ก | ได้ | ได้ | retry API | ฟ้อง token/คำขอ |
| Notion Care Audits | ออดิท Care ถาวร (ทางเลือก) | ได้ | ได้ถ้าตั้งค่า | best-effort | ไฟล์ออดิทยังจำเป็น |
| LINE Messaging API | ผลตรวจ + Care + OA | Webhook เข้า | Push/reply ออก | ซ่อมผลตรวจ; รัน Care ซ้ำ + idempotency | Case/`failed` หรือ Care audit; ม็อกใน local |
| Framer / เว็บสาธารณะ | จอง + offer | Offer/report API | Booking POST | retry ฝั่งลูกค้า | ฟ้อง validation/API |
| Scheduler / cron (ภายนอก) | สแกน/ส่ง Care | — | ยิง CLI | ตาม ops | ต้อง single-runner; rollback ด้วยแฟล็ก |
| Google Drive / Reviews / OCR | ฟีเจอร์ช่วย SPA | ได้ | ตาม OAuth/อัปโหลด | ตามเส้นทาง | นอกกรรมสิทธิ์ Case/Care |
| OpenAI (ทางเลือก) | แนะนำฟีดแบ็ก | — | ส่งพรอมต์ | fail soft | แนะนำใช้ไม่ได้ |

---

## ตาราง 8 — สถานการณ์ล้มเหลว

| สถานการณ์ | พฤติกรรมที่คาดหวัง | กู้คืน | Retry | ทำมือ |
|-----------|---------------------|--------|-------|--------|
| LINE timeout ตอนส่งผล | Case → `failed` หรือยังไม่ `sent` | repair/send-result | ได้ | เช็คโทเคน; ส่งซ้ำ |
| LINE timeout ตอน Care | Care audit FAILED; Case notify ไม่เปลี่ยน | แก้ LINE; รัน Care ใหม่ | ได้ + idempotency | fail-pause / `SEND=false` ถ้าพุ่ง |
| Notion timeout ตอนสร้าง | ไม่มี Case / error | POST จองใหม่ | ได้ | เช็คว่าไม่ได้สร้างซ้ำ |
| Notion timeout กลาง workflow | การเปลี่ยนสถานะ/ส่งล้ม | เรียกใหม่; ดูสถานะ Case | ได้ | ดูเคสค้าง `sending` |
| จองซ้ำ | ได้สอง Case ถ้าสร้างสองครั้ง | ยกเลิกตัวซ้ำ | — | ยกเลิกด้วยมือ; ห้าม merge จากชื่อ |
| Notification พังหลัง `sending` | อาจค้าง `sending` | repair-notifications | ได้ | ยืนยันก่อนบอกว่าส่งแล้ว |
| ขัดแย้งตอน merge Customer | ปฏิเสธ / ปิด MERGE | Steward แก้ | ไม่ auto | merge ด้วยมือเท่านั้น |
| Care ปิด (แฟล็ก OFF) | ไม่ส่ง care | ค่าเริ่มที่ปลอดภัย | dry-run ได้ | เปิดหลัง Checkpoint A เท่านั้น |
| Dual-write ล้ม | Case โอเค; อาจไม่มี Customer | reconcile/backfill | ได้แบบออฟไลน์ | ห้ามลบ Case |
| ร้องเรียนปลายทาง Care ผิด | หยุด Care | rollback แฟล็ก | ไม่ | `SEND=false`; เก็บออดิท |
| แข่งชิงช่อง offer | อาจเกินชิดช่วงแคช | นับใหม่ | รีเฟรช offer | ตัดสินใจความจุโดย ops |

---

## ตาราง 9 — ความครอบคลุม QA

| ฟีเจอร์ | Test Cases | พร้อมหรือยัง | หมายเหตุ |
|---------|------------|--------------|----------|
| Booking / ยกเลิก / preassessment | QA-B01–B05 | พร้อม | ดู matrix ใน 04 |
| Offer / ช่อง | QA-O01–O04 | พร้อม | |
| Workflow start/close | QA-W01–W03 | พร้อม | |
| LINE ลิงก์ / webhook | QA-L01–L03 | พร้อม | |
| แจ้งผล / retry / recovery | QA-N01–N06 | พร้อม | |
| Report / feedback / score | QA-R*, QA-F*, QA-S* | พร้อม | |
| Customer / merge / reconcile | QA-CI*, QA-M*, QA-RC* | พร้อม | เปิดแฟล็กเฉพาะ staging |
| จุดหมายแจ้ง / อ่าน LINE ตามแฟล็ก | QA-ND*, QA-LL* | พร้อม | Staging |
| Care / eligibility / audit | QA-CF*, QA-CA*, QA-ID* | พร้อม | SEND ยังปิด |
| Outcomes / governance / rollback | QA-OR*, QA-GV*, QA-RB* | พร้อม | |
| แฟล็ก / Track A | QA-FF*, QA-TA* | พร้อม | Checkpoint A ยังไม่เซ็น |
| Edge / ความปลอดภัย / ภาระ / ความทนทาน / เอกสาร | QA-EC*, SEC*, PERF*, REL*, DOC* | พร้อม | |
| **รวม** | **80 แถวใน 04** | **พร้อม Manual QA** | ห้ามเติม Actual เอง |

---

## ตาราง 10 — ตรวจสถาปัตยกรรม

| หัวข้อ | ออกแบบที่คาดหวัง | การทำจริงตอนนี้ | ตรงหรือไม่ |
|--------|-------------------|-----------------|------------|
| กรรมสิทธิ์ Case | Ops SSOT | สร้าง Case + workflow + Notion Cases | ตรง |
| กรรมสิทธิ์ Customer | ตัวตนเท่านั้น, exact match | customer-domain + migration; แฟล็กปิด | ตรง |
| กรรมสิทธิ์ Care | นโยบาย + Care Audit; ≠ Case notify | care-lifecycle; ใช้แค่ `sendLinePush` | ตรง |
| Notification | SM ของ `notificationStatus` บน Case | เขียนใน workflow-service เท่านั้น | ตรง |
| Offer | SoT ช่องจาก Case | water-check-offer-service | ตรง |
| Workflow | จัดคิวงาน Case | workflow-service | ตรง |
| แฟล็ก | ค่าเริ่ม OFF; คนเปิด | โมดูลแฟล็กทั้งคู่ default false | ตรง |
| Rollout | OFF→ENABLED→dry-run→SEND→ladder | เอกสาร + สคริปต์เกต; ไม่ auto-promote | ตรง |
| กรรมสิทธิ์ข้อมูล | Care ไม่เขียน Case notify | run.js สังเกตอย่างเดียว; มีเทสต์ | ตรง |
| Care ⊥ Customer | กลุ่มแฟล็กอิสระ | ยืนยันแล้ว | ตรง |
| หมายเหตุเล็กน้อย | ดู 02 | D1–D5 | เล็กน้อยเท่านั้น |
| ความเบี่ยงเบนใหญ่ | ไม่มี | ไม่พบ | ตรง |

---

## ตาราง 11 — ประเด็นที่ยืนยันแล้ว

| ID | ความรุนแรง | หมวด | คำอธิบาย | สถานะ |
|----|------------|------|----------|--------|
| F01 | กลาง | Operational | ยังไม่กรอกหลักฐาน Checkpoint A | เปิด — ขวาง GO |
| F02 | กลาง | Operational | ยังไม่เซ็น Checkpoint A | เปิด — ขวาง SEND |
| F03 | กลาง | Operational | ไม่บังคับ single-runner ในโค้ด | เปิด — คุมด้วย ops |
| F04 | ต่ำ | Documentation | checklist Care ซ้อนกันหลายชุด | เปิด — ใช้ Track A เป็นประตูหน้า |
| F05 | ต่ำ | Documentation | แฟล็ก OUTCOME_REPORT กับ CLI อิสระกัน | เปิด — ระบุในเอกสารแล้ว |
| F06 | ต่ำ | Reliability | Dual-write แบบ best-effort โดยออกแบบ | ยอมรับเป็น tradeoff |

---

## ตาราง 12 — สิ่งที่ต้องจำ

| กฎ | คำอธิบาย |
|----|----------|
| Case คือ Ops SSOT | ความจริงของงานอยู่ใน Case |
| Customer คือตัวตนเท่านั้น | ห้ามย้าย workflow/offer/notify ไปอยู่ที่นั่น |
| Care ≠ การแจ้งผลงาน | คนละไทม์ไลน์ คนละคลัง |
| ห้ามให้ Care เขียน `notificationStatus` | เส้นแบ่งสถาปัตยกรรมแข็ง |
| Care ใช้ `sendLinePush` | ไม่ใช้ `executeSendCaseResult` |
| Exact match เท่านั้น | ห้าม merge จากชื่อคลุมเครือ |
| เก็บฟิลด์ Case LINE ไว้ | เป็น fallback ตลอด |
| แฟล็ก Customer ค่าเริ่ม OFF | พฤติกรรมผลิตไม่เปลี่ยนจนกว่าจะเปิด |
| แฟล็ก Care ค่าเริ่ม OFF | ไม่ส่ง care เงียบๆ |
| SEND ต้องมี ENABLED | config + run บังคับ |
| แฟล็ก Care ⊥ Customer | เปิด Care ไม่จำเป็นต้องเปิด M8 |
| Dual-write ห้ามทำให้สร้าง Case พัง | ซิงก์ตัวตนแบบ best-effort |
| Offer นับจาก Case | ไม่มีคลังช่องแยก |
| เนื้อ Feedback ≠ ตัว Case | Case ถือแค่ token/สถานะ |
| Report เป็น Case แบบมี token | สาธารณะโดยไม่ล็อกอิน Notion |
| Shadow ≠ เปลี่ยนเจ้าของจริง | Case ยังเป็นเจ้าของในโหมดเงา |
| Case ชนะเมื่อ notify diverge | เมื่อเปิด READ_NOTIFY |
| Idempotency ของ Care สำคัญ | กันส่ง care ซ้ำ |
| Care ต้อง single runner | cron หลายตัวอันตราย |
| Dry-run ก่อน SEND | ห้ามข้ามหลักฐาน |
| Checkpoint A เป็นของคน | เอกสารไม่ตั้ง env |
| Rollback Care ด้วยแฟล็ก | SEND แล้วค่อย ENABLED |
| ห้ามลบ Care audit กลางเหตุการณ์ | เพื่อสืบสวน + กันส่งซ้ำ |
| เปลี่ยนนโยบายต้องมี CDR | timing/copy/throttle/eligibility |
| ห้าม auto-tuning | คนเท่านั้น |
| รักษาสัญญา Framer/LINE/Dashboard | ขยาย อย่าหัก |
| Track A ก่อน B/C/D | หลักฐานก่อนขยาย |
| คอลัมน์ Actual ใน QA ว่างจนกว่าจะทดสอบจริง | ห้ามเดา pass/fail |
| อ่านชุด verification ก่อนแก้โค้ด | 01–07 ก่อนลงมือ |
| ย้ายกรรมสิทธิ์ต้องขออนุมัติชัด | หยุดถ้า Case/Customer/Care เบลอ |

---

## สถานะสมุดทบทวน

| รายการ | ค่า |
|--------|-----|
| แก้โค้ด | ไม่มี |
| เปลี่ยนแฟล็ก | ไม่มี |
| เสนอแพตช์/วิธีแก้ | ไม่มี |
| Manual QA | พร้อม — ตาราง 9 + `04_QA_MATRIX.md` |
| ส่ง Care บน production | **ยังไม่อนุญาต** (F01/F02) |
