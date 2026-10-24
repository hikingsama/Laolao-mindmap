"use strict";
// Compatibility entry; editable templates now live in prompts/.
exports.system = allowSupplement => require("./ai-prompts.cjs").render("outline",{allowSupplement});
