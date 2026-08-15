#!/usr/bin/env bash
# Builds a deterministic local git repo for tests.
# Run this before the test suite. Do not build the fixture repo by hand.
set -e

rm -rf test/fixtures/repo
mkdir -p test/fixtures/repo
cd test/fixtures/repo

git init -q
git config user.email "test@example.com"
git config user.name "Test"
echo "init" > file.txt
git add file.txt
git commit -q -m "init"
git branch -M main

# One branch per test case. The branch name maps to an entry in
# github-api-mocks.json — that mock file, not local git state, decides
# each branch's PR status in tests.
for name in \
  feature/normal-merge \
  feature/squash-merge \
  feature/closed-no-merge \
  feature/still-open \
  feature/no-pr \
  feature/unpushed-work
do
  git checkout -q -b "$name"
  echo "$name" >> file.txt
  git commit -q -am "work on $name"
  git checkout -q main
done

echo "Fixture repo created at test/fixtures/repo"
