// Legacy API regression fixtures predate formal accounts. Production and the
// local preview never set this test-only compatibility switch.
process.env.KAI_ALLOW_LEGACY_ANON_WRITES = "TEST_ONLY_UNSAFE";
