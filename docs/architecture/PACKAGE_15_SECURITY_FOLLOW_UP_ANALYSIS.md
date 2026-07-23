# Package 15 Security Follow-Up Analysis

Date: 2026-07-23
Scope: analysis only. No SSH config change, firewall change, deploy, owner approval, or canary action was performed in this package.

## SSH Key-Only Auth Proposal

Goal: keep root SSH reachable while removing password brute-force exposure.

Recommended staged rollout:

1. Confirm provider rescue/VNC console access is available and tested.
2. Keep the current SSH session open.
3. Add at least two trusted public keys to `/root/.ssh/authorized_keys`: owner primary key and emergency/admin fallback key.
4. Verify permissions:
   - `/root/.ssh` is `700`
   - `/root/.ssh/authorized_keys` is `600`
5. Open a second terminal and verify key-based login works without password.
6. Create a temporary rollback copy of the SSH daemon config:
   - `/etc/ssh/sshd_config.pre-key-only-20260723`
7. Set password login off in SSH daemon config:
   - `PasswordAuthentication no`
   - `KbdInteractiveAuthentication no`
   - `ChallengeResponseAuthentication no` where supported
   - `PermitRootLogin prohibit-password` if root key login remains required
8. Run `sshd -t` before reload.
9. Reload SSH only, do not reboot:
   - `systemctl reload ssh` or `systemctl reload sshd`
10. With the original session still open, verify a new key-only SSH session works.

## Rollback Plan

If key-only login fails while the original session is still open:

1. Restore the backup SSH config.
2. Run `sshd -t`.
3. Reload SSH.
4. Verify password login works again from a second terminal.

If all SSH sessions are lost:

1. Use provider rescue/VNC console.
2. Mount the root filesystem if rescue mode is used.
3. Restore `/etc/ssh/sshd_config.pre-key-only-20260723`.
4. Confirm `authorized_keys` still contains the owner key.
5. Reload/restart SSH from console.

## Forensic Evidence Retention

Evidence currently kept for incident review:

- forensic Docker image created from the compromised DB container;
- pre-incident SQL dump under `/root/backups/`;
- incident notes and hardening commits.

Retention recommendation:

- keep forensic image and dump for 30 days after the incident date;
- incident date observed in the project history: 2026-07-22;
- deletion review date: 2026-08-21;
- if counting from incident closure on 2026-07-23 instead, conservative deletion review date is 2026-08-22.

Reminder note: do not delete forensic evidence before 2026-08-21, and only delete after owner confirms the incident stayed closed, backups are not needed for legal/operational review, and current production health has remained stable.

## Recommendation

Move to key-only SSH auth, but only in a dedicated maintenance window with provider rescue access confirmed and two independent SSH keys installed first. This is the highest-value remaining hardening step after port closure, firewall rules, fail2ban, and secret rotation.
