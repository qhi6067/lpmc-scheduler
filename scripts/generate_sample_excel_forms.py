from __future__ import annotations

from datetime import date
from pathlib import Path

from generate_lpmc_excel_form import (
    PHARMACIST_ROWS,
    TECH_ROWS,
    generate_schedule_form,
)


SAMPLE_OUTPUT_DIR = Path("samples") / "forms"

SAMPLE_SPECS = [
    {
        "subtitle": "Tech Schedule",
        "start_date": date(2026, 4, 12),
        "end_date": date(2026, 5, 24),
        "employee_rows": TECH_ROWS,
        "output_path": SAMPLE_OUTPUT_DIR / "Las_Palmas_Tech_Schedule_Form_2026-04-12_to_2026-05-24.xlsx",
    },
    {
        "subtitle": "Tech Schedule",
        "start_date": date(2026, 5, 31),
        "end_date": date(2026, 7, 11),
        "employee_rows": TECH_ROWS,
        "output_path": SAMPLE_OUTPUT_DIR / "Las_Palmas_Tech_Schedule_Form_2026-05-31_to_2026-07-11.xlsx",
    },
    {
        "subtitle": "Tech Schedule",
        "start_date": date(2026, 7, 12),
        "end_date": date(2026, 8, 22),
        "employee_rows": TECH_ROWS,
        "output_path": SAMPLE_OUTPUT_DIR / "Las_Palmas_Tech_Schedule_Form_2026-07-12_to_2026-08-22.xlsx",
    },
    {
        "subtitle": "Pharmacist Schedule",
        "start_date": date(2026, 4, 12),
        "end_date": date(2026, 4, 25),
        "employee_rows": PHARMACIST_ROWS,
        "output_path": SAMPLE_OUTPUT_DIR / "Las_Palmas_Pharmacist_Schedule_Form_2026-04-12_to_2026-04-25.xlsx",
    },
    {
        "subtitle": "Pharmacist Schedule",
        "start_date": date(2026, 5, 10),
        "end_date": date(2026, 5, 23),
        "employee_rows": PHARMACIST_ROWS,
        "output_path": SAMPLE_OUTPUT_DIR / "Las_Palmas_Pharmacist_Schedule_Form_2026-05-10_to_2026-05-23.xlsx",
    },
]


def main() -> None:
    SAMPLE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for spec in SAMPLE_SPECS:
        created_path = generate_schedule_form(**spec)
        print(created_path)


if __name__ == "__main__":
    main()
