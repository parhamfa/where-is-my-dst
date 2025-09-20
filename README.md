# Where is my Dst? 🌍🔍

A Safari extension that reveals the geographic origin of web requests, helping you understand where your data is going.

<img src="Shared%20(App)/Resources/Icon.png" width="128" height="128" alt="Extension Icon">

## ✨ Features

- **🌍 Real-time Country Detection**: See the country flag of the current website in your Safari toolbar
- **📡 Request Tracking**: View all network requests made by a webpage, grouped by country
- **🚫 Smart Blocking**: Block requests from specific domains with one click
- **🏠 Website Preferences**: Set site-specific blocking rules that persist across sessions
- **🎨 Beautiful UI**: Clean, animated interface with smooth transitions and intuitive controls
- **🔒 Privacy-Focused**: All processing happens locally; no data sent to third parties

## 🚀 How It Works

1. **Install the Extension**: Load the Safari extension through Xcode
2. **Browse the Web**: The extension automatically detects the country of origin for each website
3. **View Requests**: Click the extension icon to see all requests grouped by country
4. **Block Unwanted Requests**: Use the "Block" button to prevent requests from specific domains
5. **Manage Preferences**: View and manage your blocking rules in the Website Preferences section

## 🛠 Technical Details

### APIs Used
- **IP Geolocation**: `ipwho.is` for country detection
- **DNS Resolution**: `dns.google` for hostname to IP resolution
- **Browser APIs**: `webRequest`, `tabs`, `storage`, `declarativeNetRequest`

### Key Technologies
- **JavaScript (ES6+)**: Modern async/await patterns
- **CSS3**: Advanced animations and responsive design
- **SVG**: Scalable vector graphics for icons
- **Canvas API**: Dynamic icon generation

## 🔧 Installation

### Prerequisites
- macOS with Xcode installed
- Safari 14+ with developer extensions enabled

### Setup
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/parhamfa/where-is-my-dst.git
   cd where-is-my-dst
   ```

2. **Open in Xcode**:
   ```bash
   open "Where is my Dst?.xcodeproj"
   ```

3. **Build and Run**:
   - Select your target device/simulator
   - Press `Cmd+R` to build and run
   - Follow the on-screen instructions to enable the extension

4. **Enable in Safari**:
   - Open Safari → Preferences → Extensions
   - Enable "Where is my Dst?"
   - Grant necessary permissions

## 🎯 Use Cases

- **VPN Leak Detection**: In countries with heavy internet moderation (Iran, China), foreign API requests can leak your real IP if traffic is being forwarded through different routes. This extension helps identify which requests might compromise your privacy.
- **Privacy Auditing**: Understand where your browsing data is being sent and identify unexpected third-party requests.
- **Security Research**: Analyze request patterns and detect potential data exfiltration or suspicious international connections.
- **Content Blocking**: Block unwanted international requests that might be tracking or collecting data.

## 🔒 Privacy & Security

- **Local Processing**: All geolocation lookups happen in the background script
- **No Tracking**: The extension doesn't collect or transmit personal data
- **Minimal Permissions**: Only requests necessary permissions for functionality
- **Open Source**: Full source code available for audit

## 🎨 UI/UX Highlights

- **Glassmorphism Design**: Modern, translucent interface elements
- **Smooth Animations**: 60fps transitions and hover effects
- **Responsive Layout**: Adapts to different content sizes
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Dark Mode Support**: Automatic adaptation to system preferences

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Submit a pull request with a clear description

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **IP Geolocation**: Thanks to [ipwho.is](https://ipwho.is) for providing free IP geolocation services
- **DNS Resolution**: Thanks to Google's DNS-over-HTTPS service
- **Icons**: Custom-designed icons for a cohesive visual experience
- **Community**: Thanks to the Safari extension development community for guidance and best practices

## 📞 Support

If you encounter any issues or have questions:
- Open an issue on GitHub
- Check the Safari Console for error messages
- Ensure you have the latest version of Safari and macOS

---

**Made with ❤️ for privacy-conscious web browsing**
