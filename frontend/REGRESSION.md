# React migration regression matrix

Verified 2026-10-29 against isolated SQLite data and a production build in Chrome.

| Check | Result |
| --- | --- |
| Public and four preserved admin routes at 360, 390, 768, 1440 px | Passed; no page horizontal overflow, labelled inputs/selects |
| Match start → score increment → finish | Passed in admin calendar |
| Finished match → scoring deep link | Passed; matching tournament/phase and final score |
| Public results and live/calendar/standings/scoring navigation | Passed |
| Access missing/expired/wrong audience/wrong issuer, protected CRUD | Backend HTTP suite |
| Calendar filters, server order, hidden lines, group references, results, standings and goleo | React display/component suites |
| Keyboard controls | Native links/buttons/selects; public skip link and visible focus |
| SQLite migrations, participant confirmation, backups and restart | Backend suites and isolated Docker smoke |

Legacy `backend/public/display` HTML, CSS and JavaScript were unreachable behind the React shell. They and their VM/source-slicing tests were removed after verifying equivalent React component/data coverage. Express and Docker now serve only compiled frontend assets.

No live Cloudflare tunnel, Jenkins deployment, NFS mount, physical mobile keyboard or assistive-technology session was exercised. Viewport checks simulate widths, not physical hardware. Run these environment checks before rollout.
