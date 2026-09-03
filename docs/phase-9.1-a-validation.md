# Phase 9.1-A — Native PR snapshot documents

Interactive validation checklist for the immutable `gitea-pr:` document slice.

- Open a modified file from **Changes in Pull Request** and confirm the native VS Code diff renders the expected base/head content.
- Close and reopen the same file without refreshing the PR and confirm the same `gitea-pr:` document identity is reused.
- Open an added file and confirm the base side is empty while the head side contains the file.
- Open a deleted file and confirm the head side is empty while the base side contains the file.
- Open a text file whose path contains spaces and confirm the diff loads normally.
- Confirm binary files still show the existing "appears to be binary" message instead of opening a text diff.
- Push a new commit to the PR, refresh the active PR, reopen the same file, and confirm the new head snapshot is used rather than the previously opened document.
- For a PR from a fork, confirm the head document is loaded from the source repository while the base document is loaded from the target repository.
- Confirm **Open Working File** and **Open Editable PR Diff** still operate on the working tree and do not use `gitea-pr:` documents.
