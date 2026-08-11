// Legacy API regression fixtures predate formal accounts. Production and the
// local preview never set this test-only compatibility switch.
process.env.KAI_ALLOW_LEGACY_ANON_WRITES = "TEST_ONLY_UNSAFE";
process.env.KAI_HOSTING_APPROVED_IMAGES = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
process.env.KAI_HOSTING_TERMS_VERSION = "KAI_HOSTING_TERMS_2026_08";
