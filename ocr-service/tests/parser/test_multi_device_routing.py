"""
Multi-device OCR routing — forensic fix regression suite.

Real bug (user-reported, live production testing): the "Meter Readings"
capture task lets the user photograph several different physical meters
(HANNA HI98194, HACH DR300, HACH 2100Q) within one session, but the client
sent a hardcoded meter_type='ph' for every photo regardless of which
device was actually in frame. profile_loader.get_profile() restricts
match_hints auto-detection to profiles compatible with the requested
meter_type -- so hach_2100q and hach_dr300 (neither of which declares a
"ph" field) were excluded from consideration before hint-matching even
ran, forcing every photo through hanna_hi98194. Confirmed by direct
execution against the real photos' own OCR text (see the forensic report
this fix accompanies) before this file existed.

Fix: the client now sends meter_type='multi' for this capture task.
get_profile() already had unrestricted-matching behavior built in for any
meter_type that isn't a field key any profile declares (used previously
only for an empty/unset meter_type) -- 'multi' exercises that exact path,
so no new routing logic was needed, only recognizing 'multi' as a valid
request value and wiring the client to send it.

Real OCR evidence reused from prior forensic passes in this repo (NOT
re-captured for this file): REAL_084735_DETECTIONS (HACH 2100Q) and
REAL_CHLORINE_DETECTIONS (HACH DR300) are the exact same live PaddleOCR
detection lists already embedded in test_turbidity_forensic_regression.py
and test_tds_forensic_regression.py, reproduced here verbatim to prove
meter_type='multi' resolves them identically to their original dedicated
meter_type. Tests explicitly marked SYNTHETIC are new, not backed by a raw
image file (none was available to this session), and are limited to
proving structural invariants (label-based binding, exclusion boundaries)
rather than claiming real-camera reproduction.
"""

from __future__ import annotations

import unittest

from parser.field_binder import bind_fields
from parser.profile_loader import get_profile
from parser.row_grouper import MeasurementRow
from parser.spatial_parser import SpatialMeasurementParser
from parser.tokens import OcrToken

# ---------------------------------------------------------------------------
# REAL detections, reproduced verbatim from existing forensic fixtures.
# ---------------------------------------------------------------------------
REAL_084735_DETECTIONS = [
    {"text": "HACH", "score": 0.9999465942382812, "box": [351.0, 211.0, 469.0, 244.0]},
    {"text": "2100Q", "score": 0.9999651908874512, "box": [470.0, 298.0, 629.0, 347.0]},
    {"text": "OK", "score": 0.9995423555374146, "box": [249.0, 358.0, 297.0, 388.0]},
    {"text": "Turbidity", "score": 0.9998685121536255, "box": [355.0, 358.0, 463.0, 391.0]},
    {"text": "0.41", "score": 0.9999830722808838, "box": [321.0, 387.0, 529.0, 483.0]},
    {"text": "NTU", "score": 0.9999380111694336, "box": [539.0, 394.0, 604.0, 426.0]},
    {"text": "15:43:52", "score": 0.9999729990959167, "box": [525.0, 534.0, 621.0, 560.0]},
    {"text": "2026-07-15", "score": 0.9999843835830688, "box": [499.0, 568.0, 621.0, 596.0]},
    {"text": "Verify Cal", "score": 0.8977408409118652, "box": [217.0, 604.0, 326.0, 634.0]},
    {"text": "Options", "score": 0.9993025660514832, "box": [361.0, 604.0, 453.0, 634.0]},
    {"text": "Read", "score": 0.9999460577964783, "box": [517.0, 606.0, 584.0, 637.0]},
]

REAL_CHLORINE_DETECTIONS = [
    {"text": "HACH", "score": 1.0, "box": [274.0, 167.0, 416.0, 204.0]},
    {"text": "DR300", "score": 1.0, "box": [378.0, 454.0, 496.0, 489.0]},
    {"text": "Chlorine", "score": 1.0, "box": [313.0, 490.0, 412.0, 517.0]},
    {"text": "LR", "score": 1.0, "box": [253.0, 510.0, 283.0, 531.0]},
    {"text": "mg/L Cl_2", "score": 0.897, "box": [322.0, 511.0, 400.0, 536.0]},
    {"text": "HR", "score": 1.0, "box": [441.0, 515.0, 473.0, 537.0]},
    {"text": "0.0", "score": 0.999, "box": [355.0, 568.0, 483.0, 665.0]},
]

REAL_HANNA_DO_EC_DETECTIONS = [
    {"text": "HANNA", "score": 0.9998092651367188, "box": [237.0, 45.0, 415.0, 97.0]},
    {"text": "6.67", "score": 0.9938479065895081, "box": [252.0, 159.0, 336.0, 194.0]},
    {"text": "FFmDO", "score": 0.7813734412193298, "box": [329.0, 158.0, 406.0, 191.0]},
    {"text": "319", "score": 0.999893844127655, "box": [255.0, 190.0, 328.0, 227.0]},
    {"text": "μSem", "score": 0.8655194640159607, "box": [334.0, 193.0, 397.0, 221.0]},
    {"text": "HI98194", "score": 0.9866820573806763, "box": [129.0, 325.0, 230.0, 352.0]},
    {"text": "pH/EC/DO Multiparameter", "score": 0.9979845285415649, "box": [124.0, 351.0, 384.0, 382.0]},
]


class TestMultiDeviceRoutingRealEvidence(unittest.TestCase):
    """meter_type='multi' resolves each real device photo to its own
    correct profile -- proven with real, previously-captured PaddleOCR
    detections, not synthetic reproductions."""

    def test_hach_2100q_photo_resolves_to_hach_2100q_under_multi(self) -> None:
        profile = get_profile(
            meter_type="multi", texts=[d["text"] for d in REAL_084735_DETECTIONS]
        )
        self.assertEqual(profile.id, "hach_2100q")

    def test_hach_2100q_photo_end_to_end_under_multi_yields_turbidity(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084735_DETECTIONS, meter_type="multi"
        )
        self.assertEqual(payload.profile, "hach_2100q")
        self.assertEqual(payload.data.get("turbidity"), 0.41)
        self.assertNotIn("chlorine", payload.data)

    def test_hach_dr300_photo_resolves_to_hach_dr300_under_multi(self) -> None:
        profile = get_profile(
            meter_type="multi", texts=[d["text"] for d in REAL_CHLORINE_DETECTIONS]
        )
        self.assertEqual(profile.id, "hach_dr300")

    def test_hach_dr300_photo_end_to_end_under_multi_yields_chlorine(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_CHLORINE_DETECTIONS, meter_type="multi"
        )
        self.assertEqual(payload.profile, "hach_dr300")
        self.assertIn("chlorine", payload.data)
        self.assertNotIn("turbidity", payload.data)

    def test_hanna_photo_resolves_to_hanna_under_multi(self) -> None:
        profile = get_profile(
            meter_type="multi", texts=[d["text"] for d in REAL_HANNA_DO_EC_DETECTIONS]
        )
        self.assertEqual(profile.id, "hanna_hi98194")

    def test_hanna_photo_end_to_end_under_multi_yields_do_and_ec(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_HANNA_DO_EC_DETECTIONS, meter_type="multi"
        )
        self.assertEqual(payload.profile, "hanna_hi98194")
        self.assertNotIn("turbidity", payload.data)
        self.assertNotIn("chlorine", payload.data)

    def test_multi_photo_session_no_cross_photo_state_leakage(self) -> None:
        """Three real, different-device photos parsed back-to-back in one
        process (modeling one Meter Readings capture session) must each
        resolve independently -- no profile/state from one photo may leak
        into the next."""
        p1 = get_profile(meter_type="multi", texts=[d["text"] for d in REAL_HANNA_DO_EC_DETECTIONS])
        p2 = get_profile(meter_type="multi", texts=[d["text"] for d in REAL_CHLORINE_DETECTIONS])
        p3 = get_profile(meter_type="multi", texts=[d["text"] for d in REAL_084735_DETECTIONS])
        p1_again = get_profile(meter_type="multi", texts=[d["text"] for d in REAL_HANNA_DO_EC_DETECTIONS])
        self.assertEqual([p1.id, p2.id, p3.id, p1_again.id], [
            "hanna_hi98194", "hach_dr300", "hach_2100q", "hanna_hi98194",
        ])


class TestMultiFallbackWhenHintsAreMissing(unittest.TestCase):
    """Real bug (user-reported, live production testing, post-deploy):
    switching between multiple devices in one Meter Readings session --
    "most values don't fill in". Root cause: get_profile()'s last-resort
    fallback (reached whenever a photo's brand/model text is cropped out,
    angled away, or simply missed by OCR, so no match_hints fire) used to
    try generic_ph FIRST. generic_ph only declares 2 fields (ph, mv) --
    every other reading (tds, ec, temperature, do, do_percent, orp...)
    silently has nowhere to bind, no matter what the device actually
    photographed was. Before meter_type='multi' existed, this same failure
    mode was masked: meter_type='ph' hit METER_TYPE_DEFAULTS BEFORE the
    last-resort branch and got hanna_hi98194 (9 fields) instead. 'multi'
    deliberately skips that default (see get_profile()'s docstring), so it
    was the first caller to ever actually reach the risky generic_ph
    fallback. Fixed by reordering the last-resort tuple so hanna_hi98194 is
    tried first."""

    def test_no_hint_match_falls_back_to_the_richest_profile_not_generic_ph(self) -> None:
        # No brand/model text at all -- exactly what a tightly-cropped or
        # blurry photo of an unrecognized device's screen would produce.
        profile = get_profile(meter_type="multi", texts=["319", "uS/cm", "6.67", "mg/L"])
        self.assertEqual(profile.id, "hanna_hi98194")
        self.assertNotEqual(profile.id, "generic_ph")

    def test_fallback_end_to_end_still_binds_a_non_ph_reading(self) -> None:
        """Concrete proof of the failure mode this closes: an EC reading
        with no recognizable brand text must still bind under meter_type=
        'multi'. Under the old generic_ph-first fallback this returned an
        empty payload -- generic_ph has no 'ec' field at all."""
        detections = [
            {"text": "319", "score": 0.99, "box": [255.0, 190.0, 328.0, 227.0]},
            {"text": "uS/cm", "score": 0.9, "box": [334.0, 193.0, 397.0, 221.0]},
        ]
        payload = SpatialMeasurementParser().parse_detections(detections, meter_type="multi")
        self.assertEqual(payload.profile, "hanna_hi98194")
        self.assertEqual(payload.data.get("ec"), 319.0)


class TestHannaTdsAndTemperatureSynthetic(unittest.TestCase):
    """SYNTHETIC -- no real image file was available to this session for
    the HANNA TDS/salinity/temperature screen. These prove the field_binder
    mechanics (label-based binding, exclusion boundaries) added by this fix
    behave as designed; they do NOT claim real-camera reproduction. Row
    layout mirrors the real device's on-screen order as visually confirmed
    by the reporter: 125 ppmTds / 0.12 PSU / 0.0 (sigma-t) / 28.40 C."""

    @staticmethod
    def _tok(text: str, box: list[float], is_numeric: bool = False) -> OcrToken:
        return OcrToken(
            text=text, text_corrected=text, box=box, score=0.98,
            is_numeric=is_numeric, ignored=False, debug_only=False,
            cx=(box[0] + box[2]) / 2, cy=(box[1] + box[3]) / 2,
        )

    def _tds_temp_rows(self) -> list[MeasurementRow]:
        t = self._tok
        return [
            MeasurementRow(index=0, cy=100,
                            tokens=[t("125", [0, 90, 60, 110], True), t("ppmTds", [70, 90, 160, 110])],
                            value_token=t("125", [0, 90, 60, 110], True), label_token=t("ppmTds", [70, 90, 160, 110])),
            MeasurementRow(index=1, cy=200,
                            tokens=[t("0.12", [0, 190, 60, 210], True), t("PSU", [70, 190, 160, 210])],
                            value_token=t("0.12", [0, 190, 60, 210], True), label_token=t("PSU", [70, 190, 160, 210])),
            MeasurementRow(index=2, cy=300,
                            tokens=[t("0.0", [0, 290, 60, 310], True), t("st", [70, 290, 160, 310])],
                            value_token=t("0.0", [0, 290, 60, 310], True), label_token=t("st", [70, 290, 160, 310])),
            MeasurementRow(index=3, cy=400,
                            tokens=[t("28.40", [0, 390, 60, 410], True), t("C", [70, 390, 160, 410])],
                            value_token=t("28.40", [0, 390, 60, 410], True), label_token=t("C", [70, 390, 160, 410])),
        ]

    def test_literal_tds_binds_when_labeled(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        bound = {c.key: c.value for c in bind_fields(self._tds_temp_rows(), profile)}
        self.assertEqual(bound.get("tds"), 125.0)

    def test_temperature_binds_when_labeled_even_at_non_zero_row_index(self) -> None:
        """Regression guard: temperature's row_hint=0 alone would never
        reach this value (it's row 3, not row 0) -- binding here can only
        happen through the real label ('C') match, proving the fix does
        not depend on position."""
        profile = get_profile(profile_id="hanna_hi98194")
        bound = {c.key: c.value for c in bind_fields(self._tds_temp_rows(), profile)}
        self.assertEqual(bound.get("temperature"), 28.4)

    def test_psu_and_sigma_t_rows_do_not_bind_to_any_field(self) -> None:
        """PSU (salinity) and sigma-t (density anomaly) are real labels on
        this screen with no declared field of their own -- they must stay
        unbound, not get absorbed into do_percent/ec/tds via loose alias
        fuzzy-matching. (This test caught a real false-positive during
        development: do_percent's "sat" alias fuzzy-matched "st"/sigma-t
        before exclude_aliases were tightened -- see hanna_hi98194.json.)"""
        profile = get_profile(profile_id="hanna_hi98194")
        bound = {c.key: c.value for c in bind_fields(self._tds_temp_rows(), profile)}
        self.assertNotIn("do_percent", bound)
        self.assertNotIn("ec", bound)
        self.assertEqual(set(bound.keys()), {"tds", "temperature"})

    def test_unlabeled_value_at_a_non_zero_row_does_not_become_temperature(self) -> None:
        """Negative safety: hanna_hi98194's temperature field keeps its
        pre-existing row_hint=0 (proven necessary elsewhere for the HANNA
        single-value 'Info' screen -- a label-less reading at row 0). That
        fallback must stay scoped to row 0 only: an unlabeled DO%-shaped
        value sitting at a LATER row (as it would on a real multi-value
        screen where row 0 is already something else) must never be
        absorbed into temperature just because it's numerically in range."""
        t = self._tok
        rows = [
            MeasurementRow(index=0, cy=100,
                            tokens=[t("8.11", [0, 90, 60, 110], True), t("pH", [70, 90, 160, 110])],
                            value_token=t("8.11", [0, 90, 60, 110], True), label_token=t("pH", [70, 90, 160, 110])),
            MeasurementRow(index=1, cy=200,
                            tokens=[t("87.3", [0, 190, 60, 210], True)],
                            value_token=t("87.3", [0, 190, 60, 210], True), label_token=None),
        ]
        profile = get_profile(profile_id="hanna_hi98194")
        bound = {c.key: c.value for c in bind_fields(rows, profile)}
        self.assertEqual(bound.get("ph"), 8.11)
        self.assertNotIn("temperature", bound)
        self.assertNotIn("do_percent", bound)

    def test_do_percent_still_binds_correctly_with_real_label(self) -> None:
        """Regression guard for the field this fix's exclude_aliases change
        touched: a genuine %DO reading must still bind normally."""
        t = self._tok
        rows = [
            MeasurementRow(index=0, cy=100,
                            tokens=[t("90.2", [0, 90, 60, 110], True), t("%DO", [70, 90, 160, 110])],
                            value_token=t("90.2", [0, 90, 60, 110], True), label_token=t("%DO", [70, 90, 160, 110])),
        ]
        profile = get_profile(profile_id="hanna_hi98194")
        bound = {c.key: c.value for c in bind_fields(rows, profile)}
        self.assertEqual(bound.get("do_percent"), 90.2)


if __name__ == "__main__":
    unittest.main()
