# CONTENT PLATFORM

# v1.3 PRE-DEVELOPMENT EXHAUSTIVE AUDIT

# AUDIT WORK ORDER

## 1. AUDIT CÉLJA

Végezz teljes körű, bizonyíték-alapú auditot az alábbi repository aktuális állapotán:

https://github.com/ARTeomo/content-platform.git

Az audit célja annak meghatározása, hogy a repository állapota alkalmas-e a **v1.3 fejlesztésének megkezdésére**.

Ez NEM általános code review.

A vizsgálatnak három kérdésre kell egyértelmű választ adnia:

1. A 2026-09-20-i baseline auditban azonosított hiányosságok valóban és teljes körűen megszűntek-e?
2. A baseline audit óta bevezetett remediationök ténylegesen működnek-e, vagy csak részlegesen vannak bekötve?
3. Van-e olyan jelenlegi technikai, architekturális, biztonsági, adatkonzisztencia-, tesztelési vagy dokumentációs probléma, amely miatt a v1.3 fejlesztését még nem szabad megkezdeni?

Az audit végén adj egy explicit:

**V1.3 DEVELOPMENT READINESS: PASS / CONDITIONAL PASS / BLOCKED**

minősítést.

---

# 2. AUDIT ALAPELVEK

## 2.1. A jelenlegi repository az elsődleges igazságforrás

A vizsgálat során az aktuális repository állapotából indulj ki.

Ne tekints egy findingot lezártnak pusztán azért, mert:

- egy dokumentum CLOSED állapotúnak jelöli,
- egy commit message szerint „fixed”,
- egy HANDOFF szerint „done”,
- egy interface vagy service már létezik.

Minden lezárást a tényleges:

- source code,
- wiring,
- runtime path,
- database migration,
- queue configuration,
- test coverage,
- integration behaviour

alapján ellenőrizz.

---

# 3. ELSŐ LÉPÉS — REPOSITORY ÁLLAPOT RÖGZÍTÉSE

Először rögzítsd:

- aktuális branch,
- aktuális commit SHA,
- repository clean/dirty állapota,
- package manager és verzió,
- Node.js követelmény,
- workspace/package struktúra,
- alkalmazások,
- package-ek,
- database package,
- worker,
- API,
- publisher adapterek,
- queue-k,
- Redis használat,
- PostgreSQL használat.

Vizsgáld meg különösen:

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig*`
- `vitest*`
- ESLint/Prettier konfiguráció
- Docker konfiguráció
- compose konfiguráció
- migration struktúra
- `docs/`
- `HANDOFF.md`
- audit dokumentumok
- architecture dokumentumok
- changelog/release dokumentáció
- CI konfiguráció

Ne feltételezz semmilyen dokumentumból olyan állapotot, amelyet a kód nem támaszt alá.

---

# 4. KÖTELEZŐ BASELINE AUDIT RECONCILIATION

Olvasd el teljes egészében:

`docs/audit/baseline-audit-20-09-2026.md`

Ezután készíts finding-by-finding reconciliationt.

Minden findingnál válaszolj:

- Mi volt az eredeti probléma?
- Mi volt a remediation követelmény?
- Milyen commit(ok) próbálták javítani?
- Milyen jelenlegi fájlok valósítják meg?
- Melyik runtime útvonalon használódik?
- Van-e valódi integration test?
- A teszt valóban a production pathot vizsgálja?
- Van-e olyan alternate path, amely továbbra is megkerüli a javítást?
- Van-e race condition?
- Van-e transaction boundary probléma?
- Van-e fail-open viselkedés?
- Van-e silent fallback?
- Van-e dokumentációs eltérés?

---

# 5. F1 — WEBHOOK TRANSACTION BOUNDARY

Ellenőrizd teljes részletességgel a webhook ingress folyamatot.

Különösen:

1. destination resolution
2. webhook event idempotency
3. event persistence
4. outbox insertion
5. transaction boundary
6. rollback behaviour
7. concurrent delivery behaviour
8. duplicate delivery behaviour

Bizonyítsd, hogy az event és a hozzá tartozó downstream outbox state atomikusan kezelhető.

Vizsgáld:

- lehet-e event DB insert outbox nélkül?
- lehet-e outbox job event nélkül?
- mi történik transaction rollback esetén?
- mi történik két egyidejű azonos webhook esetén?
- mi történik, ha az outbox insert sikertelen?

Ne csak unit tesztet keress. Integration-level bizonyítékot keress.

---

# 6. F2 — SYSTEM CONFIG

Ellenőrizd, hogy a korábbi hardcoded/default konfiguráció valóban megszűnt-e.

Különösen:

- interaction response rules
- templates
- max response/hour
- minimum interval
- global rate limits
- Meta rate-limit budgets

Ellenőrizd:

- `SystemConfigRepository`
- runtime config loader
- seed migrations
- worker startup
- config validation
- fallback behaviour

Különösen fontos:

A konfiguráció betöltése önmagában NEM bizonyítja a finding teljesítését.

Ellenőrizd, hogy a betöltött érték:

`database → repository → loader → worker/service → policy/runtime`

útvonalon ténylegesen eljut-e a végrehajtási pontig.

Keresd meg külön azokat az értékeket, amelyek ugyan már konfigurálhatók, de ténylegesen továbbra is hardcoded értékként működnek.

---

# 7. F3 / F4 — RATE LIMITING

Teljesen auditáld a rate limiting architektúrát.

Vizsgáld:

- Redis implementation
- Lua atomicity
- destination-level limits
- global hourly limits
- global daily limits
- publication limits
- interaction limits
- Redis failure behaviour
- retry behaviour
- concurrent requests
- counter expiration
- key isolation
- key naming
- budget configuration

Különösen ellenőrizd:

- nincs-e még production pathban `NoopMetaRateLimiter`;
- nincs-e olyan adapter, amely megkerüli a Redis limitert;
- publication és interaction külön budgetet használ-e;
- destinationenként megfelelően izolált-e a számláló;
- globális limit valóban globális-e.

## Külön vizsgálat: minimum interval

A `minIntervalSeconds` konfigurációt külön ellenőrizd.

Ne elégedj meg azzal, hogy az érték:

`system_config → runtime config`

útvonalon betöltődik.

Bizonyítsd, hogy ténylegesen enforcementre kerül.

Ha konfigurálható, de a policy/runtime döntés nem használja, jelentsd findingként.

---

# 8. F5 — META CREDENTIAL LIFECYCLE

Teljes körűen ellenőrizd:

- credential storage
- encryption
- key versioning
- active key
- rotation
- invalidation
- validation
- health check
- access token resolution
- worker integration
- publisher integration
- reconciler integration

Különösen keresd meg az összes olyan production pathot, ahol Meta API hívás történik.

Minden egyes outbound Meta API path esetében bizonyítsd:

`destination → credential service → decrypted access token → Meta API`

Ne fogadd el azt, hogy csak a fő publisher path használ credential service-t.

Keresd meg:

- hardcoded tokeneket,
- `META_PAGE_ACCESS_TOKEN` közvetlen használatot,
- régi token helper implementációkat,
- bypassokat,
- fallbackeket.

A fallbackeket külön minősítsd:

- szükséges migration compatibility,
- vagy biztonsági/architekturális maradvány.

---

# 9. F6 — SCHEDULER CREDENTIAL HEALTH GATE

Ellenőrizd a publication scheduler teljes működését.

Bizonyítsd:

1. due publication claim
2. destination meghatározása
3. credential health check
4. INVALID eset kezelése
5. valid credential esetén enqueue
6. health check hiba kezelése
7. concurrency behaviour
8. duplicate enqueue prevention

Különösen vizsgáld:

- INVALID
- UNKNOWN
- VALID

állapotokat.

Ellenőrizd, hogy invalid credential esetén valóban:

**NEM történik publish job enqueue.**

---

# 10. F7 — SYSTEM QUEUES

Teljesen auditáld:

- `system.rebuild`
- `system.outbox.cleanup`

komponenseket.

Ellenőrizd:

- queue definition
- worker
- scheduler
- job schema
- retry
- idempotency
- CLI trigger
- runtime wiring
- persistence interaction
- logging
- failure handling
- tests

A `system.rebuild` esetén különösen:

- webhook events
- publications
- interaction responses

rebuildelhetőségét vizsgáld.

Bizonyítsd, hogy a rebuild nem okoz:

- duplicate external side effectet,
- duplicate publicationt,
- duplicate response-ot,
- uncontrolled queue explosiont.

---

# 11. CREDENTIAL INVALIDATION

Ellenőrizd, hogy credential invalidation csak megfelelő Meta API hibák esetén történik-e.

Különösen különítsd el:

- authentication failure
- authorization failure
- rate limit
- network error
- timeout
- provider 5xx
- malformed request

Ne legyen olyan általános hibaág, amely tévesen credential invalidationt eredményez.

Vizsgáld a retry/invalidation interakciót is.

---

# 12. WEBHOOK TOKEN / SECRET SECURITY

Teljes körűen auditáld a webhook credential és secret kezelést.

Vizsgáld:

- encryption at rest
- key management
- key rotation
- environment variables
- logs
- error messages
- database exposure
- migrations
- serialization
- API responses
- test fixtures

Keresd meg, hogy credential vagy secret megjelenhet-e:

- application logban,
- worker logban,
- exception message-ben,
- HTTP responseban,
- audit/system logban,
- teszt outputban.

---

# 13. NOTIFICATIONS / SYSTEM LOGGING / AUDIT LOGGING

Vizsgáld külön:

- notifications
- system logs
- audit logs

rendszereket.

Ne csak a táblák meglétét ellenőrizd.

Minden rendszer esetén keresd:

- schema
- repository
- service
- writer
- reader
- runtime producer
- UI/API consumer
- retention
- indexing
- authorization
- sensitive data handling

Különösen az `audit_logs` esetén állapítsd meg:

- ténylegesen működő runtime writer van-e;
- vagy csak schema/future infrastructure létezik.

Ha deferred, ne minősítsd automatikusan hibának, de dokumentáld:

**DEFERRED — NOT REQUIRED FOR V1.3 START**

vagy ha v1.3 előtt szükséges:

**BLOCKER**

---

# 14. ATOMIC CLAIMS / CONCURRENCY AUDIT

Ez legyen kiemelt vizsgálati terület.

Keress minden olyan folyamatot, ahol több worker ugyanazt a DB rekordot feldolgozhatja.

Különösen:

- webhook processing
- publication scheduling
- reconciliation
- interaction response
- rebuild
- cleanup
- outbox processing

Minden ilyen folyamatnál vizsgáld:

- DB claim atomicity
- row locking
- state transition
- compare-and-set behaviour
- transaction isolation
- duplicate job creation
- duplicate external API call
- retry after crash

Ne fogadd el azt a mintát, hogy:

`SELECT → application decision → UPDATE`

ha ez concurrent worker mellett race conditiont okozhat.

---

# 15. DATABASE AUDIT

Teljes schema audit szükséges.

Vizsgáld:

- összes migration sorrendjét;
- foreign key-ket;
- unique constraint-eket;
- indexes;
- check constraint-eket;
- enum/state mezőket;
- nullable mezőket;
- cascade behaviourt;
- transaction dependencyket;
- idempotency key-ket;
- timestamp semantics;
- retention/cleanup lehetőségeket.

Különösen keresd meg azokat az adatbázis-szabályokat, amelyeket a TypeScript application code feltételez, de a database nem kényszerít ki.

---

# 16. QUEUE / OUTBOX AUDIT

Teljesen térképezd fel:

- queue-k
- job names
- job IDs
- payloadok
- retry policy
- backoff
- dead-letter behaviour
- outbox state machine
- cleanup
- rebuild

Minden queue esetén legyen megválaszolható:

- mi indítja?
- mi fogyasztja?
- mi történik failure esetén?
- mi történik retry esetén?
- hogyan akadályozzuk meg a duplicate side effectet?
- hogyan recoveryzhető?
- hogyan monitorozható?

---

# 17. PUBLISHER / META ADAPTER AUDIT

Készíts listát az összes publisher adapterről.

Minden adapter esetén ellenőrizd:

- credential acquisition
- rate limiting
- retry
- error mapping
- authentication error
- authorization error
- idempotency
- timeout
- logging
- reconciliation
- response persistence

Különösen ellenőrizd, hogy nincs-e olyan régi adapter-path, amely már nincs összhangban az új credential/rate-limit architektúrával.

---

# 18. TEST AUDIT

Ne csak azt ellenőrizd, hogy a tesztek PASS állapotúak.

Vizsgáld a tesztminőséget.

Keresd:

- `describe.skip`
- `it.skip`
- `test.skip`
- `skipIf`
- TODO teszteket
- mockolt production dependencyket
- fake repositorykat
- teszteket, amelyek nem futnak DB nélkül
- teszteket, amelyek csak a service saját mockját ellenőrzik

Különösen fontos a:

`describe.skipIf(!TEST_DB_URL)`

jellegű tesztek vizsgálata.

Jelentsd:

- melyik teszt production behaviourt bizonyít;
- melyik csak unit behaviourt;
- melyik nem fut alapértelmezett test command alatt;
- melyik integration dependencyt igényel.

---

# 19. TEST COVERAGE — CRITICAL PATHS

A következő esetekhez kötelezően keress tesztet:

### Webhook

- duplicate event
- concurrent event
- rollback
- outbox failure

### Credential

- missing credential
- invalid credential
- rotation
- invalidation
- authentication failure
- non-authentication failure

### Scheduler

- valid credential
- invalid credential
- unknown credential state
- health-check failure
- concurrent scheduler

### Rate limiter

- destination limit
- global limit
- daily limit
- Redis failure
- concurrent calls
- expiration

### Rebuild

- empty state
- partial state
- duplicate invocation
- concurrent invocation
- failed downstream job

### Cleanup

- eligible records
- non-eligible records
- concurrent cleanup
- retry/failure

---

# 20. SECURITY AUDIT

A v1.3 start előtt külön security pass szükséges.

Vizsgáld:

- authentication
- authorization
- credential encryption
- secret handling
- webhook verification
- input validation
- SQL injection
- command injection
- SSRF
- path traversal
- unsafe deserialization
- log injection
- sensitive information disclosure
- error disclosure
- dependency vulnerabilities
- insecure defaults

Ne csak statikus keresést végezz.

A tényleges runtime pathokat is kövesd.

---

# 21. DEPENDENCY / SUPPLY CHAIN AUDIT

Vizsgáld:

- package versions
- lockfile consistency
- known vulnerabilities
- deprecated packages
- duplicate dependencies
- unused dependencies
- direct vs transitive dependencies
- scripts with lifecycle execution
- package provenance where relevant

A dependency audit eredményét különítsd el:

- blocker
- warning
- informational

kategóriákra.

---

# 22. ARCHITECTURE CONSISTENCY

A repository jelenlegi architektúráját hasonlítsd össze:

- `docs/architecture`
- README-k
- HANDOFF
- audit dokumentumok
- tényleges source code

állapotával.

Keresd a dokumentáció és implementáció közötti eltéréseket.

Különösen:

- elavult diagramok
- elavult queue lista
- elavult schema lista
- régi credential modell
- régi rate-limit modell
- régi worker wiring
- régi configuration model

---

# 23. V1.3 ELŐFELTÉTELEK

A végső audit egyik legfontosabb része legyen annak meghatározása:

**Mi kell ahhoz, hogy a v1.3 fejlesztése biztonságosan elkezdhető legyen?**

Készíts három listát:

## A. MUST FIX BEFORE V1.3

Csak valódi blocker kerüljön ide.

## B. SHOULD FIX BEFORE V1.3

Nem blokkolja a fejlesztés megkezdését, de technikai adósságot vagy kockázatot jelent.

## C. DEFERRED TO V1.3+

Olyan funkciók vagy hiányosságok, amelyek tudatosan későbbre halaszthatók.

Ne tegyél egy problémát MUST FIX kategóriába pusztán azért, mert „jobb lenne megcsinálni”.

Indokold minden blocker esetében:

- mi a konkrét technikai kockázat;
- melyik komponens érintett;
- reprodukálható-e;
- miért akadályozza a v1.3-at;
- mi szükséges a lezárásához.

---

# 24. V1.3 FEJLESZTÉSI KOCKÁZATI TÉRKÉP

A végén készíts dependency-aware térképet.

Azonosítsd:

- mi stabil;
- mi még változó;
- mihez nem szabad hozzányúlni;
- mely komponensek rendelkeznek erős tesztfedettséggel;
- melyek gyengék;
- melyeknek van magas couplingja;
- melyek a v1.3 fejlesztés kritikus alapjai.

Külön jelöld:

**STABLE FOUNDATION**

**CHANGE-SENSITIVE**

**HIGH-RISK**

**KNOWN DEFERRED**

területeket.

---

# 25. KÖTELEZŐ AUDIT OUTPUT

Az audit végén ne csak szöveges összefoglalót adj.

Készíts az alábbi struktúrában eredményt:

## Executive Summary

- repository SHA
- audit date
- overall verdict
- v1.3 readiness

## Baseline Reconciliation

| Finding | Original issue | Current implementation | Evidence | Tests | Status |
| ------- | -------------- | ---------------------- | -------- | ----- | ------ |

## New Findings

| ID  | Severity | Component | Finding | Evidence | Recommendation | V1.3 impact |
| --- | -------- | --------- | ------- | -------- | -------------- | ----------- |

Severity:

- P0 — Critical / immediate blocker
- P1 — High / v1.3 blocker
- P2 — Medium
- P3 — Low
- INFO

## Test Assessment

- full test result
- skipped tests
- integration tests
- missing critical tests
- typecheck
- lint
- build
- format
- dependency audit

## Architecture Assessment

- database
- queue
- worker
- API
- publishers
- credentials
- rate limiting
- configuration
- observability

## V1.3 Gate

### MUST FIX BEFORE V1.3

...

### SHOULD FIX BEFORE V1.3

...

### DEFERRED

...

### VERIFIED STABLE

...

## Final Verdict

Exactly one:

**PASS**

**CONDITIONAL PASS**

**BLOCKED**

The verdict must be justified by evidence.

---

# 26. EVIDENCE RULE

Minden jelentett findinghez adj konkrét bizonyítékot.

Legalább:

- file path
- relevant symbol/function/class
- line range where possible
- relevant test
- relevant commit if useful

Ne használj ilyen állításokat bizonyíték nélkül:

- „looks correct”
- „seems implemented”
- „probably fixed”
- „appears safe”
- „should work”

A megfelelő forma:

**Observation → Evidence → Impact → Verdict**

---

# 27. FONTOS AUDITORI TILALMAK

Az audit során:

- NE módosíts source code-ot;
- NE javíts findingokat;
- NE írj át migrationt;
- NE commitolj;
- NE pusholj;
- NE módosíts audit dokumentumot;
- NE készíts „javító” PR-t;
- NE tekints dokumentációt önmagában bizonyítéknak;
- NE tekints zöld unit tesztet integration proofnak;
- NE feltételezd, hogy egy service használatban van csak azért, mert létezik.

Az audit feladata:

**READ → TRACE → VERIFY → TEST → REPORT**

nem pedig:

**READ → MODIFY → FIX → REPORT**

---

# 28. KÜLÖNLEGESEN FONTOS V1.3 ELŐTT

A v1.3 fejlesztésének megkezdése előtt külön ellenőrizd, hogy a repositoryban nincs-e olyan rejtett technikai adósság, amely miatt a v1.3 új funkciói egy instabil alapra épülnének.

Különösen keresd:

- párhuzamos régi és új implementációkat;
- deprecated, de még használt API-kat;
- dead code-ot;
- unused services;
- unused interfaces;
- régi fallbackeket;
- hardcoded production konfigurációkat;
- részlegesen bekötött service-eket;
- mock-only implementációkat;
- integration teszt nélküli kritikus folyamatokat;
- implicit transaction dependencyket;
- queue/state-machine inkonzisztenciákat;
- olyan feature-öket, amelyek dokumentáció szerint késznek vannak jelölve, de runtime-ban nem teljesek.

---

# 29. VÉGSŐ KÉRDÉS

Az audit végén egyértelműen válaszolj:

> **Ha a mai repository állapotból indulnánk, technikailag és architekturálisan biztonságos-e a v1.3 fejlesztésének megkezdése anélkül, hogy előbb a v1.2/baseline alapréteghez vissza kellene nyúlni?**

Ha igen:

**V1.3 DEVELOPMENT READY — PASS**

Ha csak kisebb, nem blokkoló problémák maradtak:

**V1.3 DEVELOPMENT READY — CONDITIONAL PASS**

Ha alapvető stabilitási, biztonsági, adatkonzisztencia- vagy architekturális probléma maradt:

**V1.3 DEVELOPMENT BLOCKED**

A végső verdictet kizárólag a ténylegesen összegyűjtött bizonyíték alapján add meg.
