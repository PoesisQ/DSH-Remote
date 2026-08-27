# Third-party and release notes

DSH Suite is an independent companion project, not an official DeepSeek product.

- DeepSeek Harness is an external runtime, not vendored here. Install it separately and review its upstream terms.
- Windows desktop uses Microsoft .NET Framework and Microsoft Edge WebView2. SDK/runtime binaries are build prerequisites, not part of the source archive. Review Microsoft's redistribution terms before publishing compiled desktop packages.
- NovaTab source in modules/novatab is the user's existing module copied into this suite. Its npm dependencies and versions are recorded in its lockfile; review their included license/notice files.
- The relay uses @upstash/redis; Android uses AndroidX WebKit and Android build tooling. Review dependency licenses and service terms before distribution.
- No project-wide LICENSE has been selected by the owner yet. Do not label this release as MIT/Apache or claim full open-source licensing until that decision and the source provenance review are complete.

This is a release checklist, not a substitute for complete third-party license notices in binary distributions.
