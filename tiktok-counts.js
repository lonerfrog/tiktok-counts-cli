const fs = require('fs')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const cliProgress = require('cli-progress')

// Enable stealth mode to bypass detection
puppeteer.use(StealthPlugin())

// Load configuration
function loadConfig(configPath) {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
		return config
	} catch (error) {
		console.error(`Error loading config file: ${error.message}`)
		return { retries: 3, rankLimit: 5 }
	}
}

// Read TikTok usernames from a file
function readUsernamesFromFile(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf-8')
		const usernames = Array.from(
			new Set(
				data
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			)
		)
		console.log(`Loaded ${usernames.length} unique usernames.`)
		return usernames
	} catch (error) {
		console.error(`Error reading usernames file: ${error.message}`)
		return []
	}
}

// Format large numbers into shorthand (e.g., 4.3M, 323K)
function formatNumber(value) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
	return value.toString()
}

// Get the top N users based on a specific metric
function getTopUsers(results, metric, count = 5) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map(
			(user, index) =>
				`${index + 1}. ${user.username} - ${formatNumber(
					user[metric] || 0
				)} ${metric}`
		)
		.join('\n')
}

// Scrape TikTok profile data
async function scrapeTikTokProfile(username, retries, progressBar) {
	const url = `https://www.tiktok.com/@${username}`
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})

	const page = await browser.newPage()
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
	)

	let attempts = 0
	let data = null

	while (attempts < retries) {
		attempts++
		try {
			progressBar.update({ username: `@${username}` })

			// Navigate to the user's profile
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			// Extract data
			data = await page.evaluate(() => {
				function parseShorthand(value) {
					if (!value) return 0
					const multiplier = value.includes('K')
						? 1000
						: value.includes('M')
						? 1000000
						: 1
					return parseFloat(value.replace(/[KM]/, '').replace(/,/g, '')) * multiplier
				}

				const followersText =
					document.querySelector('[data-e2e="followers-count"]')?.textContent || '0'
				const likesText =
					document.querySelector('[data-e2e="likes-count"]')?.textContent || '0'

				const followers = parseShorthand(followersText)
				const likes = parseShorthand(likesText)

				const videos = []
				let totalViews = 0

				document
					.querySelectorAll('div[data-e2e="user-post-item"]')
					.forEach((video) => {
						const viewsText =
							video.querySelector('strong[data-e2e="video-views"]')?.textContent || '0'
						const views = parseShorthand(viewsText)
						const link = video.querySelector('a')?.href || 'N/A'

						videos.push({ views, link })
						totalViews += views
					})

				return { followers, likes, totalViews, totalVideos: videos.length, videos }
			})

			if (data.videos.length > 0) break // Exit loop if videos are found
			console.log(
				`Retrying @${username}, videos list is empty (Attempt ${attempts}/${retries})`
			)
		} catch (error) {
			console.log(
				`Error scraping @${username}, retrying (Attempt ${attempts}/${retries})`
			)
		}
	}

	await browser.close()

	if (!data || data.videos.length === 0) {
		return { username, error: 'Failed to fetch non-empty videos after retries' }
	}

	return { username, ...data }
}

// Ensure reports folder exists
function ensureReportsFolder() {
	const reportsPath = path.join(__dirname, 'reports')
	if (!fs.existsSync(reportsPath)) fs.mkdirSync(reportsPath)
	return reportsPath
}

// Main function
;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'

	const { retries, rankLimit } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)

	const progressBar = new cliProgress.SingleBar(
		{
			format:
				'Progress [{bar}] {percentage}% | {value}/{total} Users | Current User: {username}',
		},
		cliProgress.Presets.shades_classic
	)
	progressBar.start(usernames.length, 0, { username: '' })

	const results = []
	for (const username of usernames) {
		const data = await scrapeTikTokProfile(username, retries, progressBar)
		results.push(data)
		progressBar.increment()
	}

	progressBar.stop()

	const totalVideos = results.reduce(
		(sum, user) => sum + (user.totalVideos || 0),
		0
	)
	const totalFollowers = results.reduce(
		(sum, user) => sum + (user.followers || 0),
		0
	)
	const totalLikes = results.reduce((sum, user) => sum + (user.likes || 0), 0)
	const totalViews = results.reduce(
		(sum, user) => sum + (user.totalViews || 0),
		0
	)

	const topUsersByFollowers = getTopUsers(results, 'followers', rankLimit)
	const topUsersByViews = getTopUsers(results, 'total views', rankLimit)
	const topUsersByLikes = getTopUsers(results, 'likes', rankLimit)

	const reportsFolder = ensureReportsFolder()
	const now = new Date()
	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	const outputData = {
		results,
		totals: {
			totalUsers: usernames.length,
			totalVideos,
			totalFollowers,
			totalLikes,
			totalViews,
		},
		highest: {
			topUsersByFollowers,
			topUsersByViews,
			topUsersByLikes,
		},
	}

	fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2))
	console.log(`Results saved to ${outputFilePath}`)

	// Print summary
	setTimeout(() => {
		console.log('\n--- TikTok Takeover Stats ---')
		console.log(`Total Users: ${usernames.length}`)
		console.log(`Total Videos: ${totalVideos}`)
		console.log(`Total Followers: ${formatNumber(totalFollowers)}`)
		console.log(`Total Likes: ${formatNumber(totalLikes)}`)
		console.log(`Total Views: ${formatNumber(totalViews)}`)
		console.log(`\nTop ${rankLimit} Users by Followers:\n${topUsersByFollowers}`)
		console.log(`\nTop ${rankLimit} Users by Views:\n${topUsersByViews}`)
		console.log(`\nTop ${rankLimit} Users by Likes:\n${topUsersByLikes}`)
	}, 5000)
})()
