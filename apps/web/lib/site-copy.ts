export const copy = {
  en: {
    metadataTitle: "Volo AI — Local text-to-speech for desktop",
    metadataDescription:
      "Create speech from text on your own computer with Volo AI. Download the desktop app for macOS, Windows, and Linux.",
    navigation: "Main navigation",
    aboutLink: "Why Volo",
    downloadLink: "Downloads",
    languageLabel: "Language",
    heroEyebrow: "A LOCAL TEXT-TO-SPEECH STUDIO",
    heroTitle: "Your words,",
    heroAccent: "spoken naturally.",
    heroBody:
      "Turn text into speech on your desktop with Volo AI. Your text and generated audio stay on your device.",
    heroAction: "Find your download",
    sourceAction: "Explore on GitHub",
    heroFootnote:
      "Model files download during setup. After that, speech generation runs locally.",
    workflowLabel: "A LOCAL WORKFLOW",
    workflowStatus: "On your machine",
    workflowInput: "01 / YOUR TEXT",
    workflowQuote: "“The quietest tools often do the most important work.”",
    workflowModel: "02 / VOICE MODEL",
    workflowModels: "OmniVoice + VieNeu",
    workflowOutput: "03 / YOUR AUDIO",
    workflowFormats: "WAV · MP3",
    workflowFootnote: "Text in. Audio out. No cloud upload.",
    aboutEyebrow: "MADE FOR PRIVATE WORKFLOWS",
    aboutTitle: "A capable voice studio, close at hand.",
    features: [
      {
        label: "LOCAL BY DEFAULT",
        title: "Your work stays yours.",
        body: "Text, voice files, and generated audio stay on your computer.",
      },
      {
        label: "SET UP ONCE",
        title: "Download models, then work offline.",
        body: "Volo AI downloads its model files during first-run setup. Synthesis runs locally after setup.",
      },
      {
        label: "DESKTOP BUILT",
        title: "One app for three systems.",
        body: "Choose the build for Apple Silicon macOS, Windows x64, or Linux x64.",
      },
    ],
    downloadsEyebrow: "DESKTOP DOWNLOADS",
    downloadsTitle: "Choose your system.",
    downloadsIntro:
      "Installers link directly to the latest stable GitHub release. Pick your system to see the available files.",
    latestRelease: "LATEST STABLE RELEASE",
    publishedOn: "Published",
    releaseNotes: "Release notes",
    noReleaseTitle: "The first stable release is not published yet.",
    noReleaseBody:
      "There are no installers to download yet. Check GitHub Releases for updates.",
    unavailableTitle: "Release details are unavailable right now.",
    unavailableBody:
      "GitHub did not return the latest release. Try again later or check GitHub Releases directly.",
    releasesLink: "View GitHub Releases",
    homeLink: "Home",
    changelogLink: "Changelog",
    changelogMetadataTitle: "Volo AI — Changelog",
    changelogMetadataDescription:
      "Every stable Volo AI release, with notes and direct installer downloads for each version.",
    changelogEyebrow: "RELEASE HISTORY",
    changelogTitle: "Every stable release,",
    changelogAccent: "on the record.",
    changelogIntro:
      "Release notes from the project changelog, with direct installer downloads for each version.",
    changelogEmptyTitle: "No stable release has been published yet.",
    changelogEmptyBody: "Published releases will appear here.",
    changelogDownloadUnavailable:
      "No verified installer is available for this version.",
    featuresLink: "Features",
    featuresCta: "See all features",
    featuresMetadataTitle: "Volo AI — Features",
    featuresMetadataDescription:
      "Local text-to-speech with OmniVoice and VieNeu, clone and design voice profiles, audio history, a CLI, MCP tools, and an optional local API — all on your computer.",
    featuresEyebrow: "WHAT THE APP CAN DO",
    featuresTitle: "A full voice studio,",
    featuresAccent: "on your machine.",
    featuresIntro:
      "Volo AI synthesizes speech locally on macOS, Windows, and Linux. Here are the main features available in the desktop app and its companion tools today.",
    featureGroups: [
      {
        label: "SYNTHESIS",
        title: "Two engines, fully local.",
        intro: "Pick an engine per take; both run entirely on your hardware.",
        items: [
          {
            title: "OmniVoice and VieNeu",
            body: "Choose the OmniVoice or VieNeu provider for each take. Models download once during first-run setup; after that, synthesis works offline.",
          },
          {
            title: "English and Vietnamese",
            body: "Set the synthesis language independently of the interface language.",
          },
          {
            title: "Generation controls",
            body: "Shape output with OmniVoice's advanced options and VieNeu's own sampler settings, including an optional seed for repeatable results.",
          },
          {
            title: "WAV and MP3 export",
            body: "Save every take as a WAV file or a compressed MP3 — VieNeu output stays at 48 kHz, OmniVoice generates at 24 kHz.",
          },
        ],
      },
      {
        label: "VOICE PROFILES",
        title: "Voices you make and keep.",
        intro: "Keep reusable voices in a local library.",
        items: [
          {
            title: "Clone from real audio",
            body: "Create a Clone profile from a reference recording and reuse it across takes.",
          },
          {
            title: "Design a voice in words",
            body: "Describe the sound you want in a Design profile; no audio needed.",
          },
          {
            title: "VieNeu presets",
            body: "Pick named preset voices for VieNeu, or batch-import the bundled preset catalog into profiles.",
          },
          {
            title: "Import audio and seed folders",
            body: "Add your own audio files or whole seed folders straight from Voice Profiles.",
          },
          {
            title: "One local library",
            body: "Profiles live in the app's local data directory. MCP can share them when configured to use that same directory.",
          },
        ],
      },
      {
        label: "AUDIO HISTORY",
        title: "Your output, organized.",
        intro: "Generated files stay in your output folder.",
        items: [
          {
            title: "Playback built in",
            body: "Listen to any take from the History view — WAV and MP3 files both appear, including older ones without saved details.",
          },
          {
            title: "Rename, copy path, delete",
            body: "Rename a take while keeping its extension and metadata, copy its local file path, or delete it after confirmation.",
          },
          {
            title: "Recent takes at hand",
            body: "Workspace keeps the five latest takes of the session ready for replay.",
          },
        ],
      },
      {
        label: "INTERFACES",
        title: "Beyond the window.",
        intro: "The same engine, wherever you work.",
        items: [
          {
            title: "A terminal CLI",
            body: "The tts command generates speech and manages voice profiles from your shell.",
          },
          {
            title: "MCP server for agents",
            body: "Run the engine as an MCP server; Settings generates copyable setup for Codex CLI, Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot, and Zed.",
          },
          {
            title: "Optional local API",
            body: "Start a REST API on 127.0.0.1:8765 from Settings > MCP when local scripts need it. It is off until you start it, uses no token, and stops with the app.",
          },
        ],
      },
      {
        label: "QUIET UPKEEP",
        title: "Maintenance without surprises.",
        intro: "Updates, hardware, and diagnostics on your terms.",
        items: [
          {
            title: "Release notices only",
            body: "Volo AI checks for a newer stable release at startup — and whenever you ask — then shows a notice with a link to that release. It never downloads or installs an update itself.",
          },
          {
            title: "Optional NVIDIA runtime",
            body: "Linux x64 runs on CPU by default. Install a version-matched NVIDIA runtime from Settings; if the GPU check fails, synthesis falls back to CPU.",
          },
          {
            title: "Local diagnostics",
            body: "Recent errors stay in bounded local logs. Export a report only when you choose — it redacts your home path and omits your text and audio.",
          },
          {
            title: "English, Vietnamese, and three themes",
            body: "Switch the interface between English and Vietnamese and choose a light, dark, or system theme. The interface language is stored separately from the synthesis language.",
          },
        ],
      },
    ],
    featuresOutroTitle: "Ready when you are.",
    featuresOutroBody:
      "Download Volo AI for macOS, Windows, or Linux and keep your voice work local.",
    platforms: {
      macos_arm64: { name: "macOS", architecture: "Apple Silicon · ARM64" },
      windows_x64: { name: "Windows", architecture: "64-bit · x64" },
      linux_x64: { name: "Linux", architecture: "64-bit · x64" },
    },
    downloadFile: "Download",
    noBuildYet: "No stable installer has been published for this system yet.",
    missingBuild: "This release has no installer for this system.",
    unableToCheck: "Could not check for an installer.",
    macWarning:
      "macOS builds are currently unsigned and not notarized, so Gatekeeper may show a warning.",
    macHelpTitle: "Having trouble opening Volo AI on Mac?",
    macTrustNotice:
      "Use these steps only for a build downloaded from the official Volo AI GitHub Releases page, and only if you trust the file and believe it has not been altered.",
    openStepOne: "Try opening Volo AI once, then close the warning.",
    openStepTwo:
      "Open System Settings → Privacy & Security. Find the Volo AI message, choose Open Anyway, then confirm.",
    damagedTitle: "If macOS says “Volo AI is damaged”",
    damagedBody:
      "Delete that copy and download it again from the official Releases page. If the warning remains, stop and contact the maintainer. Do not use the Gatekeeper workaround for a damaged-app warning.",
    advancedTitle: "Advanced: temporarily turn off Gatekeeper",
    advancedReason:
      "These builds do not have an Apple Developer ID signature or Apple notarization. That is why macOS cannot verify the developer signature or notarization for Volo AI.",
    advancedRisk:
      "This is a system-wide change. It weakens macOS protection for all apps, not only Volo AI. Use it only for local testing with a build from the official Releases page, then turn Gatekeeper back on immediately. It will not repair an app that is corrupted or altered.",
    advancedDisable: "In Terminal, run this command, then open Volo AI:",
    advancedEnable: "After the one-time open attempt, restore Gatekeeper:",
    advancedCheck: "Confirm macOS reports that assessments are enabled:",
    adminPassword: "macOS may ask for your administrator password.",
    appleSafetyLink: "Apple's app safety guidance",
    appleCommandLink: "Apple's Gatekeeper command guidance",
    footerText: "A local voice studio for your desktop.",
    footerNote: "Built for macOS, Windows, and Linux.",
  },
  vi: {
    metadataTitle: "Volo AI — Chuyển văn bản thành giọng nói trên máy tính",
    metadataDescription:
      "Tạo giọng nói từ văn bản ngay trên máy tính với Volo AI. Tải ứng dụng cho macOS, Windows và Linux.",
    navigation: "Điều hướng chính",
    aboutLink: "Về Volo AI",
    downloadLink: "Tải ứng dụng",
    languageLabel: "Ngôn ngữ",
    heroEyebrow: "CÔNG CỤ CHUYỂN VĂN BẢN THÀNH GIỌNG NÓI CỤC BỘ",
    heroTitle: "Biến câu chữ",
    heroAccent: "thành giọng nói.",
    heroBody:
      "Chuyển văn bản thành giọng nói ngay trên máy tính với Volo AI. Văn bản và âm thanh tạo ra được lưu trên thiết bị của bạn.",
    heroAction: "Chọn bản tải xuống",
    sourceAction: "Xem trên GitHub",
    heroFootnote:
      "Ứng dụng tải các tệp mô hình trong lần thiết lập đầu tiên. Sau đó, việc tạo giọng nói chạy cục bộ.",
    workflowLabel: "QUY TRÌNH CỤC BỘ",
    workflowStatus: "Chạy trên máy bạn",
    workflowInput: "01 / VĂN BẢN",
    workflowQuote: "“Những công cụ yên lặng nhất thường làm được nhiều điều quan trọng.”",
    workflowModel: "02 / MÔ HÌNH GIỌNG NÓI",
    workflowModels: "OmniVoice + VieNeu",
    workflowOutput: "03 / ÂM THANH",
    workflowFormats: "WAV · MP3",
    workflowFootnote: "Nhập văn bản. Nhận âm thanh. Không tải lên đám mây.",
    aboutEyebrow: "THIẾT KẾ CHO QUY TRÌNH RIÊNG TƯ",
    aboutTitle: "Phòng thu giọng nói, ngay trên máy bạn.",
    features: [
      {
        label: "CỤC BỘ MẶC ĐỊNH",
        title: "Nội dung luôn ở trên máy bạn.",
        body: "Văn bản, tệp giọng nói và âm thanh tạo ra được lưu trên máy tính.",
      },
      {
        label: "THIẾT LẬP MỘT LẦN",
        title: "Tải mô hình, sau đó dùng ngoại tuyến.",
        body: "Volo AI tải các tệp mô hình trong lần thiết lập đầu tiên. Sau đó, việc tổng hợp giọng nói chạy cục bộ.",
      },
      {
        label: "ỨNG DỤNG MÁY TÍNH",
        title: "Một ứng dụng, ba hệ điều hành.",
        body: "Chọn bản dành cho macOS Apple Silicon, Windows x64 hoặc Linux x64.",
      },
    ],
    downloadsEyebrow: "ỨNG DỤNG MÁY TÍNH",
    downloadsTitle: "Chọn hệ điều hành.",
    downloadsIntro:
      "Liên kết tải trỏ thẳng đến GitHub Release ổn định mới nhất. Chọn hệ điều hành để xem các tệp có sẵn.",
    latestRelease: "BẢN ỔN ĐỊNH MỚI NHẤT",
    publishedOn: "Phát hành",
    releaseNotes: "Ghi chú phiên bản",
    noReleaseTitle: "Bản ổn định đầu tiên chưa được phát hành.",
    noReleaseBody:
      "Hiện chưa có bộ cài để tải. Xem GitHub Releases để biết khi có bản mới.",
    unavailableTitle: "Hiện chưa lấy được thông tin bản phát hành.",
    unavailableBody:
      "GitHub chưa trả về bản mới nhất. Hãy thử lại sau hoặc xem trực tiếp GitHub Releases.",
    releasesLink: "Xem GitHub Releases",
    homeLink: "Trang chủ",
    changelogLink: "Nhật ký thay đổi",
    changelogMetadataTitle: "Volo AI — Nhật ký thay đổi",
    changelogMetadataDescription:
      "Mọi bản phát hành ổn định của Volo AI, kèm ghi chú và liên kết tải trực tiếp bộ cài cho từng phiên bản.",
    changelogEyebrow: "LỊCH SỬ PHÁT HÀNH",
    changelogTitle: "Mọi bản ổn định,",
    changelogAccent: "đều được ghi lại.",
    changelogIntro:
      "Ghi chú phát hành từ tệp nhật ký thay đổi của dự án, kèm liên kết tải trực tiếp bộ cài cho từng phiên bản.",
    changelogEmptyTitle: "Chưa có bản ổn định nào được phát hành.",
    changelogEmptyBody: "Các bản phát hành sẽ xuất hiện tại đây.",
    changelogDownloadUnavailable:
      "Chưa có bộ cài đã xác minh cho phiên bản này.",
    featuresLink: "Tính năng",
    featuresCta: "Xem tất cả tính năng",
    featuresMetadataTitle: "Volo AI — Tính năng",
    featuresMetadataDescription:
      "Chuyển văn bản thành giọng nói cục bộ với OmniVoice và VieNeu, hồ sơ giọng Clone và Design, lịch sử âm thanh, CLI, công cụ MCP và API cục bộ tùy chọn — tất cả trên máy của bạn.",
    featuresEyebrow: "KHẢ NĂNG CỦA ỨNG DỤNG",
    featuresTitle: "Phòng thu đầy đủ,",
    featuresAccent: "ngay trên máy bạn.",
    featuresIntro:
      "Volo AI tổng hợp giọng nói cục bộ trên macOS, Windows và Linux. Dưới đây là các tính năng chính của ứng dụng và công cụ đi kèm hiện nay.",
    featureGroups: [
      {
        label: "TỔNG HỢP GIỌNG NÓI",
        title: "Hai engine, chạy hoàn toàn cục bộ.",
        intro: "Chọn engine cho từng lần tạo; cả hai đều chạy trên phần cứng của bạn.",
        items: [
          {
            title: "OmniVoice và VieNeu",
            body: "Chọn provider OmniVoice hoặc VieNeu cho mỗi lần tạo. Mô hình chỉ tải một lần trong thiết lập đầu tiên; sau đó việc tổng hợp chạy ngoại tuyến.",
          },
          {
            title: "Tiếng Anh và tiếng Việt",
            body: "Đặt ngôn ngữ tổng hợp độc lập với ngôn ngữ giao diện.",
          },
          {
            title: "Điều khiển quá trình tạo",
            body: "Tinh chỉnh âm thanh với các tùy chọn nâng cao của OmniVoice và bộ tham số sampler riêng của VieNeu, gồm cả seed tùy chọn để tái tạo kết quả.",
          },
          {
            title: "Xuất WAV và MP3",
            body: "Lưu mỗi lần tạo thành tệp WAV hoặc MP3 nén — âm thanh VieNeu giữ nguyên 48 kHz, OmniVoice tạo ở 24 kHz.",
          },
        ],
      },
      {
        label: "HỒ SƠ GIỌNG NÓI",
        title: "Giọng do bạn tạo và giữ lại.",
        intro: "Lưu các giọng có thể dùng lại trong thư viện cục bộ.",
        items: [
          {
            title: "Clone từ âm thanh thật",
            body: "Tạo hồ sơ Clone từ một bản ghi tham chiếu và dùng lại cho các lần tạo sau.",
          },
          {
            title: "Design bằng lời mô tả",
            body: "Mô tả giọng bạn muốn trong hồ sơ Design; không cần âm thanh mẫu.",
          },
          {
            title: "Preset VieNeu",
            body: "Chọn giọng preset có sẵn cho VieNeu, hoặc nhập hàng loạt danh mục preset đi kèm thành hồ sơ.",
          },
          {
            title: "Nhập âm thanh và thư mục seed",
            body: "Thêm tệp âm thanh của bạn hoặc cả thư mục seed ngay trong Voice Profiles.",
          },
          {
            title: "Một thư viện cục bộ",
            body: "Hồ sơ được lưu trong thư mục dữ liệu cục bộ của ứng dụng. MCP có thể dùng chung nếu được cấu hình trỏ đến đúng thư mục đó.",
          },
        ],
      },
      {
        label: "LỊCH SỬ ÂM THANH",
        title: "Kết quả của bạn, luôn ngăn nắp.",
        intro: "Các tệp đã tạo nằm trong thư mục output của bạn.",
        items: [
          {
            title: "Nghe lại ngay trong app",
            body: "Phát lại bất kỳ lần tạo nào từ mục History — cả tệp WAV và MP3, kể cả tệp cũ chưa có thông tin chi tiết.",
          },
          {
            title: "Đổi tên, sao chép đường dẫn, xóa",
            body: "Đổi tên lần tạo mà vẫn giữ phần mở rộng và metadata, sao chép đường dẫn tệp trên máy, hoặc xóa sau khi xác nhận.",
          },
          {
            title: "Các lần tạo gần đây",
            body: "Workspace giữ sẵn năm lần tạo mới nhất của phiên làm việc để phát lại.",
          },
        ],
      },
      {
        label: "NHIỀU CÁCH DÙNG",
        title: "Không chỉ trong cửa sổ ứng dụng.",
        intro: "Cùng một engine, ở mọi nơi bạn làm việc.",
        items: [
          {
            title: "CLI trên terminal",
            body: "Lệnh tts tạo giọng nói và quản lý hồ sơ giọng ngay từ shell.",
          },
          {
            title: "MCP server cho agent",
            body: "Chạy engine như một MCP server; mục Settings tạo sẵn cấu hình để sao chép cho Codex CLI, Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot và Zed.",
          },
          {
            title: "API cục bộ tùy chọn",
            body: "Khởi động REST API trên 127.0.0.1:8765 từ Settings > MCP khi script cục bộ cần. API mặc định tắt, không dùng token và dừng cùng ứng dụng.",
          },
        ],
      },
      {
        label: "VẬN HÀNH YÊN TĨNH",
        title: "Bảo trì không bất ngờ.",
        intro: "Cập nhật, phần cứng và chẩn đoán theo cách của bạn.",
        items: [
          {
            title: "Chỉ thông báo bản mới",
            body: "Volo AI kiểm tra bản ổn định mới hơn khi khởi động — và bất cứ khi nào bạn yêu cầu — rồi hiện thông báo kèm liên kết đến bản phát hành đó. Ứng dụng không tự tải hay cài đặt bản cập nhật.",
          },
          {
            title: "Runtime NVIDIA tùy chọn",
            body: "Bản Linux x64 chạy CPU theo mặc định. Cài đặt runtime NVIDIA khớp phiên bản từ Settings; nếu kiểm tra GPU thất bại, việc tổng hợp quay về CPU.",
          },
          {
            title: "Chẩn đoán lưu cục bộ",
            body: "Các lỗi gần đây nằm trong nhật ký cục bộ có giới hạn. Chỉ khi bạn chọn, app mới xuất báo cáo đã ẩn đường dẫn thư mục home và không chứa văn bản hay âm thanh của bạn.",
          },
          {
            title: "Ngôn ngữ và chủ đề giao diện",
            body: "Chuyển giao diện giữa tiếng Anh và tiếng Việt, chọn giao diện sáng, tối hoặc theo hệ thống. Ngôn ngữ giao diện được lưu riêng với ngôn ngữ tổng hợp.",
          },
        ],
      },
    ],
    featuresOutroTitle: "Sẵn sàng khi bạn cần.",
    featuresOutroBody:
      "Tải Volo AI cho macOS, Windows hoặc Linux và giữ công việc giọng nói trên máy của bạn.",
    platforms: {
      macos_arm64: { name: "macOS", architecture: "Apple Silicon · ARM64" },
      windows_x64: { name: "Windows", architecture: "64-bit · x64" },
      linux_x64: { name: "Linux", architecture: "64-bit · x64" },
    },
    downloadFile: "Tải xuống",
    noBuildYet: "Chưa có bộ cài ổn định cho hệ điều hành này.",
    missingBuild: "Bản phát hành này không có bộ cài cho hệ điều hành này.",
    unableToCheck: "Chưa thể kiểm tra bộ cài.",
    macWarning:
      "Các bản macOS hiện chưa được ký và notarize, nên Gatekeeper có thể hiển thị cảnh báo.",
    macHelpTitle: "Không mở được Volo AI trên máy Mac?",
    macTrustNotice:
      "Chỉ làm theo các bước này với bản tải từ trang GitHub Releases chính thức của Volo AI, và chỉ khi bạn tin tưởng tệp đó, đồng thời cho rằng tệp không bị chỉnh sửa.",
    openStepOne: "Thử mở Volo AI một lần, sau đó đóng cảnh báo.",
    openStepTwo:
      "Mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật. Tìm thông báo về Volo AI, chọn Open Anyway (Mở dù sao), rồi xác nhận.",
    damagedTitle: "Nếu macOS báo “Volo AI bị hỏng”",
    damagedBody:
      "Xóa bản đó rồi tải lại từ trang Releases chính thức. Nếu cảnh báo vẫn còn, hãy dừng lại và liên hệ maintainer. Không dùng cách bỏ qua Gatekeeper cho cảnh báo ứng dụng bị hỏng.",
    advancedTitle: "Nâng cao: tạm tắt Gatekeeper",
    advancedReason:
      "Các bản này chưa có chữ ký Apple Developer ID và chưa được Apple notarize. Vì vậy macOS không thể xác minh chữ ký nhà phát triển hoặc trạng thái notarization của Volo AI.",
    advancedRisk:
      "Thao tác này áp dụng cho toàn hệ thống và làm giảm bảo vệ của macOS với mọi ứng dụng, không riêng Volo AI. Chỉ dùng để thử bản tải từ trang Releases chính thức, rồi bật lại Gatekeeper ngay. Lệnh này không sửa được ứng dụng bị hỏng hoặc bị chỉnh sửa.",
    advancedDisable: "Mở Terminal, chạy lệnh này, sau đó mở Volo AI:",
    advancedEnable: "Sau lần thử mở ứng dụng, bật lại Gatekeeper:",
    advancedCheck: "Xác nhận macOS báo assessments đang bật:",
    adminPassword: "macOS có thể yêu cầu mật khẩu quản trị viên.",
    appleSafetyLink: "Hướng dẫn an toàn ứng dụng của Apple",
    appleCommandLink: "Hướng dẫn lệnh Gatekeeper của Apple",
    footerText: "Phòng thu giọng nói cục bộ trên máy tính.",
    footerNote: "Dành cho macOS, Windows và Linux.",
  },
} as const;

export type Locale = keyof typeof copy;

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "vi";
}
