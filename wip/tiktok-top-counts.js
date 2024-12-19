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
		return { ...config, concurrency: config.concurrency || 5 }
	} catch (error) {
		console.error(`Error loading config file: ${error.message}`)
		return { retries: 3, rankLimit: 5, concurrency: 5 }
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

// Helper to format large numbers into shorthand (e.g., 4.3M, 323K)
function formatNumber(value) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
	return value.toString()
}

// Helper to get top N users based on a metric
function getTopUsers(results, metric, count = 5) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map(
			(user, index) =>
				`${index + 1}. @${user.username} - ${formatNumber(
					user[metric] || 0
				)} ${metric}`
		)
		.join('\n')
}

// Process users in batches to control concurrency
async function processInBatches(usernames, batchSize, task) {
	const results = []
	const progressBar = new cliProgress.SingleBar(
		{
			format:
				'Progress [{bar}] {percentage}% | {value}/{total} Users | Current User: {username}',
		},
		cliProgress.Presets.shades_classic
	)
	progressBar.start(usernames.length, 0, { username: '' })

	for (let i = 0; i < usernames.length; i += batchSize) {
		const batch = usernames.slice(i, i + batchSize).map((username) =>
			task(username).then((result) => {
				progressBar.increment(1, { username: `@${username}` })
				return result
			})
		)
		results.push(...(await Promise.all(batch)))
	}

	progressBar.stop()
	return results
}

// Scrape TikTok profile data
async function scrapeTikTokProfile(username, retries) {
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
	while (attempts < retries) {
		attempts++
		try {
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			const data = await page.evaluate(() => {
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

				return {
					followers: parseShorthand(followersText),
					likes: parseShorthand(likesText),
					totalViews,
					totalVideos: videos.length,
					videos,
				}
			})

			await browser.close()
			return { username, ...data }
		} catch (error) {
			console.log(`Retrying @${username}, attempt ${attempts}/${retries}`)
		}
	}

	await browser.close()
	return { username, error: 'Failed after retries' }
}

;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'
	const reportsFolder = path.join(__dirname, 'reports')

	if (!fs.existsSync(reportsFolder)) fs.mkdirSync(reportsFolder)

	const { retries, rankLimit, concurrency } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)

	const results = await processInBatches(usernames, concurrency, (username) =>
		scrapeTikTokProfile(username, retries)
	)

	const totals = {
		totalUsers: results.length,
		totalVideos: results.reduce((sum, user) => sum + (user.totalVideos || 0), 0),
		totalFollowers: results.reduce((sum, user) => sum + (user.followers || 0), 0),
		totalLikes: results.reduce((sum, user) => sum + (user.likes || 0), 0),
		totalViews: results.reduce((sum, user) => sum + (user.totalViews || 0), 0),
	}

	const topFollowers = getTopUsers(results, 'followers', rankLimit)
	const topViews = getTopUsers(results, 'totalViews', rankLimit)
	const topLikes = getTopUsers(results, 'likes', rankLimit)

	const now = new Date()
	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	fs.writeFileSync(
		outputFilePath,
		JSON.stringify(
			{
				timestamp: now.toISOString(),
				totals,
				results,
				topFollowers,
				topViews,
				topLikes,
			},
			null,
			2
		)
	)

	console.log('\n--- Summary ---')
	console.log(`Total Users: ${totals.totalUsers}`)
	console.log(`Total Videos: ${totals.totalVideos}`)
	console.log(`Total Followers: ${formatNumber(totals.totalFollowers)}`)
	console.log(`Total Likes: ${formatNumber(totals.totalLikes)}`)
	console.log(`Total Views: ${formatNumber(totals.totalViews)}`)
	console.log(`\nTop ${rankLimit} Users by Followers:\n${topFollowers}`)
	console.log(`\nTop ${rankLimit} Users by Views:\n${topViews}`)
	console.log(`\nTop ${rankLimit} Users by Likes:\n${topLikes}`)
})()
