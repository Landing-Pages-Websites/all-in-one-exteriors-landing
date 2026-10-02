import assert from "node:assert/strict";
import test from "node:test";
import {
  MEGA_ARTICLE_IMAGE_HOST,
  canOptimizeBlogImage,
  isLocalBlogImage,
} from "./blog-images.ts";

test("isLocalBlogImage accepts only paths this site serves itself", () => {
  // Anything true here becomes a filesystem lookup under `public/`, so a
  // remote URL must never pass, however much it looks like a path.
  for (const src of ["/blog/cover.webp", "/blog/a b.png", "/"]) {
    assert.equal(isLocalBlogImage(src), true, src);
  }
  for (const src of [
    `//${MEGA_ARTICLE_IMAGE_HOST}/article_images/acme/cover.webp`,
    `https://${MEGA_ARTICLE_IMAGE_HOST}/article_images/acme/cover.webp`,
    "http://localhost/blog/cover.webp",
    "data:image/png;base64,AAAA",
    "blog/cover.webp",
    "./blog/cover.webp",
    "",
  ]) {
    assert.equal(isLocalBlogImage(src), false, src || "(empty)");
  }
});

test("canOptimizeBlogImage allows local paths and MEGA article S3 URLs", () => {
  assert.equal(canOptimizeBlogImage("/blog/cover.webp"), true);
  assert.equal(
    canOptimizeBlogImage(
      `https://${MEGA_ARTICLE_IMAGE_HOST}/article_images/acme/cover.webp`,
    ),
    true,
  );
  assert.equal(
    canOptimizeBlogImage(
      "https://s3.us-east-2.amazonaws.com/zleague-public-prod/article_images/acme/cover.webp",
    ),
    true,
  );
});

test("canOptimizeBlogImage rejects other remotes so they render unoptimized", () => {
  assert.equal(canOptimizeBlogImage("https://cdn.example.com/x.webp"), false);
  assert.equal(
    canOptimizeBlogImage(
      "https://s3.us-east-2.amazonaws.com/someone-else/cover.webp",
    ),
    false,
  );
  assert.equal(canOptimizeBlogImage("not a url"), false);
  assert.equal(canOptimizeBlogImage("//cdn.example.com/x.webp"), false);
  assert.equal(
    canOptimizeBlogImage(
      `//${MEGA_ARTICLE_IMAGE_HOST}/article_images/acme/cover.webp`,
    ),
    false,
  );
});
