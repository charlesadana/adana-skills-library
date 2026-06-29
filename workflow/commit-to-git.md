Please commit to git by following these steps (do not use DEV for versioning as this is PRODUCTION):

Check git status to ensure clean working directory
Check today's date
Create/Update version in versions/version.ts and ensure to update:
DEFAULT_VERSION
DEFAULT_DATE (current date)
VERSION_HISTORY
Regenerate the skill registry before staging: python plugins/adana-dsa/scripts/gen_skills_index.py
Use git add . to stage all changes
Commit with descriptive message that starts with the version number
Git push origin
Add tag (after commit is pushed)
Git push the tag to git
