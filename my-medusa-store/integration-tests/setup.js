const { MetadataStorage } = require("@mikro-orm/core")

// Keep MikroORM metadata clean between test runs
MetadataStorage.clear()

// Reduce Medusa logger noise in integration tests unless explicitly overridden
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = "error"
}
