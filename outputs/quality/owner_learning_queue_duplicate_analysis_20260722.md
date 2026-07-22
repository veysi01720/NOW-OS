# Owner Learning Queue Duplicate Analysis - Sanitized

Generated: 2026-07-22

Source: read-only analysis of production `ingestion.json`. This report lists only queue IDs and counts; suggestion content is intentionally omitted.

## Counts

- Total learning suggestions: 110.
- Approved suggestions: 5.
- Pending owner review: 105.
- Pending created_at range: 2026-07-07T13:43:58.692Z through 2026-07-22T16:14:17.307Z.
- Exact duplicate groups including source message/job fields: 10 groups, 50 extra duplicate records.
- Content-only duplicate groups: 15 groups, 55 extra duplicate records.
- Content plus created_at exact duplicate groups: 0 groups in the current persisted file.

Interpretation: the queue contains real historical duplicate accumulation. The current dedupe fix prevents new same-source live owner notes from being inserted again, but the old 105 pending records were not cleaned.

## Exact Source+Content Duplicate Groups

- LRN-16, LRN-17
- LRN-23, LRN-32
- LRN-25, LRN-30, LRN-31, LRN-77
- LRN-37, LRN-38, LRN-39, LRN-40, LRN-41, LRN-42, LRN-43, LRN-44, LRN-45, LRN-46, LRN-47, LRN-48, LRN-49, LRN-50, LRN-51, LRN-52, LRN-53
- LRN-57, LRN-58
- LRN-66, LRN-67
- LRN-68, LRN-69
- LRN-79, LRN-80, LRN-81, LRN-82, LRN-83, LRN-84, LRN-85, LRN-86, LRN-87, LRN-88, LRN-89, LRN-92, LRN-93, LRN-94, LRN-95, LRN-96, LRN-97, LRN-98, LRN-99, LRN-100, LRN-101, LRN-102, LRN-103, LRN-104, LRN-105
- LRN-106, LRN-108
- LRN-107, LRN-109

## Content-Only Duplicate Groups

- LRN-4, LRN-8
- LRN-5, LRN-9
- LRN-6, LRN-10
- LRN-7, LRN-11
- LRN-16, LRN-17
- LRN-23, LRN-32
- LRN-25, LRN-30, LRN-31, LRN-77
- LRN-35, LRN-36
- LRN-37, LRN-38, LRN-39, LRN-40, LRN-41, LRN-42, LRN-43, LRN-44, LRN-45, LRN-46, LRN-47, LRN-48, LRN-49, LRN-50, LRN-51, LRN-52, LRN-53
- LRN-57, LRN-58
- LRN-66, LRN-67
- LRN-68, LRN-69
- LRN-79, LRN-80, LRN-81, LRN-82, LRN-83, LRN-84, LRN-85, LRN-86, LRN-87, LRN-88, LRN-89, LRN-92, LRN-93, LRN-94, LRN-95, LRN-96, LRN-97, LRN-98, LRN-99, LRN-100, LRN-101, LRN-102, LRN-103, LRN-104, LRN-105
- LRN-106, LRN-108
- LRN-107, LRN-109

No bulk reject/delete action was applied. If owner approves a cleanup package later, these IDs are the candidate duplicate groups for review.
