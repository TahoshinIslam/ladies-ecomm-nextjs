// Confirmed audit finding: POST /api/reviews/[id]/helpful
// (services/reviewService.js's markHelpful()) unconditionally incremented
// reviews.helpful_count with no record of who voted — a single
// authenticated user could call it repeatedly to inflate a review's score.
// This table gives each (review, user) pair at most one vote, enforced by
// a real UNIQUE constraint (not just an app-level check-then-insert),
// exactly like every other vote/usage-limit table in this schema.
//
// Policy for existing counts: this migration does NOT retroactively zero
// or reconcile reviews.helpful_count — those prior increments have no
// recorded voter identity to reconstruct, and guessing would be exactly
// the kind of unverifiable, evidence-free "repair" this audit's own rules
// forbid. Existing counts are left as historical, pre-dedupe totals; only
// votes cast AFTER this migration are deduplicated.
//
// Policy for anonymous users: N/A here — POST /api/reviews/[id]/helpful
// already requires requireUser() (see the route), so there is no
// anonymous-vote path to account for.
const migration = {
  id: "0001_review_helpful_votes",
  description: "Add review_helpful_votes table for per-user helpful-vote dedupe",
  async up(conn) {
    // No FOREIGN KEY on review_id/user_id — matches this schema's own
    // documented convention (see sql/schema.sql's header): a column that
    // references an independent top-level entity (reviews, users) is a
    // plain indexed column with no FK, exactly like every order_id/
    // product_id/user_id elsewhere. A hard-deleted user's dangling votes
    // are left in place, same as their dangling reviews/addresses/orders.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS review_helpful_votes (
        review_id CHAR(24) NOT NULL,
        user_id CHAR(24) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (review_id, user_id),
        KEY idx_review_helpful_votes_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
};

export default migration;
