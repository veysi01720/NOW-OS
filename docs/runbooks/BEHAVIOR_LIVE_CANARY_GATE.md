# BEHAVIOR LIVE CANARY GATE (B4)

## Zorunlu Kapılar
- **PC-off ve VPS Stabilization**: 'PASS' olmak zorundadır.
- **Security Seals (B1, B2, B3, Full Suite, Build)**: 'PASS' olmak zorundadır.
- **Rollback ve Doctor Health**: 'PASS' olmak zorundadır.

## Owner Approval Formatı
Approval yalnızca config (data/behavior_canary_approval.json) tabanlı olabilir:
\\\json
{
  " approved\: true,
 \scope\: \single_internal_owner\,
 \issuedAt\: \2026-07-11T12:00:00Z\,
 \expiresAt\: \2026-07-11T13:00:00Z\,
 \approvalId\: \...\,
 \approvedByRole\: \owner\
}
\\\

## Customer Impact Waiver
Waiver yalnızca \customer_impact_check\ için geçerlidir:
\\\json
{
 \approved\: true,
 \gate\: \customer_impact_check\,
 \reasonCategory\: \deferred_after_canary\,
 \issuedAt\: \...\,
 \expiresAt\: \...\,
 \approvedByRole\: \owner\
}
\\\

## Limitler
- **Canary Window**: Sadece expiresAt ile zaman limitlidir. DB migration yapılmadığı için mesaj limiti sayacı uygulanmamıştır. Süresi dolan approval reddedilir.

## Rollback
- Herhangi bir hata veya timeout anında gate default-deny (fail-closed) çalışır ve legacy behavior devam eder.
