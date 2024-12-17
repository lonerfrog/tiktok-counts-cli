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
		return { retries: 3 }
	}
}

// Read TikTok usernames from a file
function readUsernamesFromFile(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf-8')
		return data
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	} catch (error) {
		console.error(`Error reading usernames file: ${error.message}`)
		return []
	}
}

// Check if TikTok user exists
async function checkUserExists(page, username) {
	try {
		const url = `https://www.tiktok.com/@${username}`
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
		const notFound = await page.$("div[data-e2e='user-not-found']")
		return !notFound
	} catch (error) {
		return false
	}
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

	for (let i = 0; i < retries; i++) {
		try {
			progressBar.update({ username: `@${username}` })

			const exists = await checkUserExists(page, username)
			if (!exists) {
				console.log(`User @${username} does not exist.`)
				await browser.close()
				return { username, error: 'User not found' }
			}

			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			const data = await page.evaluate(() => {
				const followers = parseInt(
					document
						.querySelector('[data-e2e="followers-count"]')
						?.textContent.replace(/,/g, '') || '0'
				)
				const likes = parseInt(
					document
						.querySelector('[data-e2e="likes-count"]')
						?.textContent.replace(/,/g, '') || '0'
				)

				const videos = []
				let totalViews = 0
				document
					.querySelectorAll('div[data-e2e="user-post-item"]')
					.forEach((video) => {
						const views = parseInt(
							video
								.querySelector('strong[data-e2e="video-views"]')
								?.textContent.replace(/,/g, '') || '0'
						)
						const link = video.querySelector('a')?.href || 'N/A'
						videos.push({ views, link })
						totalViews += views
					})

				return { followers, likes, totalViews, totalVideos: videos.length, videos }
			})

			await browser.close()
			return { username, ...data }
		} catch (error) {
			console.log(`Retrying @${username}, attempt ${i + 1}`)
		}
	}

	await browser.close()
	return { username, error: 'Failed after retries' }
}

// Ensure reports folder exists
function ensureReportsFolder() {
	const reportsPath = path.join(__dirname, 'reports')
	if (!fs.existsSync(reportsPath)) fs.mkdirSync(reportsPath)
	return reportsPath
}

// Helper to get top N users based on a metric
function getTopUsers(results, metric, count = 5) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map((user) => ({ username: user.username, [metric]: user[metric] }))
}

// Main function
;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'

	const { retries } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)

	// Initialize progress bar with dynamic user name display
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

	const topUsersByFollowers = getTopUsers(results, 'followers')
	const topUsersByViews = getTopUsers(results, 'totalViews')
	const topUsersByLikes = getTopUsers(results, 'likes')

	const videoWithMostViews = results
		.flatMap((user) => user.videos || [])
		.reduce((max, video) => (video.views > max.views ? video : max), { views: 0 })

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
			videoWithMostViews,
		},
	}

	fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2))
	console.log(`Results saved to ${outputFilePath}`)

	// Print summary
	console.log('\n--- Summary ---')
	console.log(`Total Users: ${usernames.length}`)
	console.log(`Total Videos: ${totalVideos}`)
	console.log(`Total Followers: ${totalFollowers}`)
	console.log(`Total Likes: ${totalLikes}`)
	console.log(`Total Views: ${totalViews}`)

	console.log('\nTop 5 Users by Followers:')
	topUsersByFollowers.forEach((user, i) =>
		console.log(`${i + 1}. @${user.username} - ${user.followers} followers`)
	)

	console.log('\nTop 5 Users by Views:')
	topUsersByViews.forEach((user, i) =>
		console.log(`${i + 1}. @${user.username} - ${user.totalViews} views`)
	)

	console.log('\nTop 5 Users by Likes:')
	topUsersByLikes.forEach((user, i) =>
		console.log(`${i + 1}. @${user.username} - ${user.likes} likes`)
	)

	console.log(
		`\nVideo with Most Views: ${videoWithMostViews.link} (${videoWithMostViews.views} views)`
	)
})()
