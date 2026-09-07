# GPT-5.6 Sol price review — 2026-09-06

Reviewed the current [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), Standard service, short/default context (up to 272K tokens), USD per million tokens. The reviewed input / cached-input / output prices are **4 / 0.4 / 20**, replacing the older **5 / 0.5 / 30** baseline. Cache writes, Batch, Flex, Fast mode, long context, regional uplift and reseller fees are separate price categories and are not included in this row. The official page describes the Sol pricing as promotional, available at least through 2026-11-21; future changes require another review.

The exact LiteLLM `gpt-5.6-sol` entry independently matched the same three per-token rates after multiplication by one million. The old output-price baseline exceeded the existing 25% discrepancy threshold, correctly causing REVIEW_REQUIRED and blocking publication.

Only this reviewed registry row changes. The existing pipeline restaged and validated all 55 rows, retained the established fixed index basket/history and atomically promoted a fresh bundled snapshot. No freshness timestamp, deviation threshold, minimum coverage or index denominator was manually modified. Production still requires deploying this registry and running its normal stage/promote task; the bundled source snapshot alone is not proof of a production update.

The frontend freeze test pins this reviewed bundled snapshot to SHA-256 `d30533c9b60c5f746dc02434406bc80f8c2304c3b0d74755a52d122fbc959c5a`. Its baseline, page/component hashes and frozen-file list remain unchanged. Future bundled snapshot changes still require an explicit content review and hash update; the existing production stage/promote pipeline continues to validate each runtime update independently.
