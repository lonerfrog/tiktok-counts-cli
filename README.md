Here’s the updated **`README.md`** file that includes **Top 5 Users** for each category:

1. **Most Followers**
2. **Most Total Views**
3. **Most Total Likes**

This version also provides details about the outputs and highlights the **top performers** in each metric.

---

## **TikTok Profile Scraper**

### **Overview**

The **TikTok Profile Scraper** is a Node.js-based tool that scrapes TikTok user profiles to gather insights such as:

- Total followers
- Total likes
- Total video views
- Total number of videos
- Links to all posted videos with view counts

It also identifies:

- The **Top 5 users with the most followers**
- The **Top 5 users with the most total video views**
- The **Top 5 users with the most total likes**
- The **video with the highest views**

Results are saved to a timestamped JSON file in the `reports` folder for easy tracking.

---

### **Features**

- ✅ Scrapes TikTok user data:
  - Followers
  - Total likes
  - Total views
  - Total videos
  - Video links and view counts
- ✅ Supports **retry mechanism** to handle failures.
- ✅ Progress bar for real-time status updates.
- ✅ Outputs results in a JSON file saved in the `reports` folder.
- ✅ Detects non-existent TikTok user profiles.
- ✅ Highlights:
  - Top 5 users with the most followers.
  - Top 5 users with the most views.
  - Top 5 users with the most likes.
  - Video with the most views.
- ✅ Aggregates total users, videos, followers, likes, and views.

---

### **Requirements**

- **Node.js** (v14+)
- **npm** (Node Package Manager)

---

### **Installation**

1. **Clone the Repository**

   ```bash
   git clone https://github.com/your-username/tiktok-profile-scraper.git
   cd tiktok-profile-scraper
   ```

2. **Install Dependencies**
   Install the required Node.js packages:

   ```bash
   npm install
   ```

3. **Set Up Input Files**

   - Create a `tiktok_users.txt` file in the root directory.  
     Add TikTok usernames (one per line):

     ```
     masterqq98
     alonelyfrog
     loner.art
     ```

   - Create a `config.json` file to configure retries:
     ```json
     {
     	"retries": 3
     }
     ```

---

### **Usage**

1. Run the script:

   ```bash
   node script.js
   ```

2. **Output**:
   - A JSON file will be generated in the `reports` folder with a name like:
     ```
     tiktok_results_2024-06-09T15-45-30-000Z.json
     ```
   - The console will display a progress bar and summary.

---

### **Sample Output**

**Console Output**:

```
Starting TikTok scraping for 5 users...
Progress: ███████████████████ 100%

--- Summary ---
Total Users: 5
Total Videos: 87

Top 5 Users by Followers:
1. @masterqq98 - 1,200,000 followers
2. @alonelyfrog - 850,000 followers
3. @loner.art - 620,000 followers
4. @artsyboi - 530,000 followers
5. @creativegal - 470,000 followers

Top 5 Users by Total Views:
1. @masterqq98 - 12,500,000 views
2. @alonelyfrog - 8,300,000 views
3. @loner.art - 7,200,000 views
4. @artsyboi - 5,800,000 views
5. @creativegal - 4,900,000 views

Top 5 Users by Total Likes:
1. @masterqq98 - 2,100,000 likes
2. @alonelyfrog - 1,500,000 likes
3. @loner.art - 1,200,000 likes
4. @artsyboi - 950,000 likes
5. @creativegal - 820,000 likes

Video with the most views:
Link: https://tiktok.com/video/12345
Views: 5,000,000
Results saved to reports/tiktok_results_2024-06-09T15-45-30-000Z.json
```

**Sample JSON Report**:

```json
{
	"results": [
		{
			"username": "masterqq98",
			"followers": 1200000,
			"likes": 2100000,
			"totalViews": 12500000,
			"totalVideos": 12,
			"videos": [
				{ "views": 5000000, "link": "https://tiktok.com/video/123" },
				{ "views": 450000, "link": "https://tiktok.com/video/456" }
			]
		}
	],
	"totals": {
		"totalFollowers": 3700000,
		"totalLikes": 5500000,
		"totalViews": 32000000,
		"totalVideos": 87,
		"totalUsers": 5
	},
	"highest": {
		"topUsersByFollowers": [
			{ "username": "masterqq98", "followers": 1200000 },
			{ "username": "alonelyfrog", "followers": 850000 }
		],
		"topUsersByViews": [
			{ "username": "masterqq98", "totalViews": 12500000 },
			{ "username": "alonelyfrog", "totalViews": 8300000 }
		],
		"topUsersByLikes": [
			{ "username": "masterqq98", "likes": 2100000 },
			{ "username": "alonelyfrog", "likes": 1500000 }
		],
		"videoWithMostViews": {
			"link": "https://tiktok.com/video/123",
			"views": 5000000
		}
	}
}
```

---

### **Configuration**

Modify the `config.json` file to customize the retry behavior:

```json
{
	"retries": 5
}
```

---

### **Folder Structure**

```
tiktok-profile-scraper/
│
├── script.js           # Main script file
├── tiktok_users.txt    # List of TikTok usernames to scrape
├── config.json         # Retry configuration
├── reports/            # Folder where reports are saved
└── README.md           # Project documentation
```

---

### **Dependencies**

The script relies on the following Node.js libraries:

- **puppeteer-extra**: Automates browser actions.
- **puppeteer-extra-plugin-stealth**: Bypasses TikTok’s bot detection mechanisms.
- **cli-progress**: Displays a progress bar.

Install them with:

```bash
npm install puppeteer-extra puppeteer-extra-plugin-stealth cli-progress
```

---

### **Troubleshooting**

- **CAPTCHAs or Rate Limits**:

  - Avoid running the scraper too quickly.
  - Increase delays between requests if necessary.

- **Timeout Errors**:
  - Extend the timeout values in the script if scraping takes too long.

---

### **License**

This project is licensed under the **MIT License**. You’re free to use, modify, and distribute it.

---

### **Contributing**

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```
3. Commit changes:
   ```bash
   git commit -m "Add your feature"
   ```
4. Push and create a pull request.

---

### **Author**

Developed by **Snoop Frogg**.
