const { json, send } = require('micro')
const GitHubApi = require('github')
const pino = require('pino')
const config = require('./config')

const pretty = pino.pretty()

pretty.pipe(process.stdout)

const logger = pino({
  level: 'debug',
}, pretty)

const github = new GitHubApi({
  debug: config.debug,
  headers: {
    'user-agent': 'gold-miner-robot',
  },
})

github.authenticate({
  type: 'token',
  token: config.github.token,
})

const addComment = function addComment(number, body) {
  return github.issues.createComment({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    body,
  })
}

const removeLabel = function removeLabel(number, label) {
  return github.issues.removeLabel({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    name: label,
  })
}

const addLabels = function addLabels(number, labels) {
  return github.issues.addLabels({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    labels,
  })
}

const includes = function (target, keywords) {
  const words = Array.isArray(keywords) ? keywords : [ keywords ]

  for (let i = 0; i < words.length; i += 1) {
    if (target.includes(words[i])) {
      return true
    }
  }

  return false
}

const handleApplyForTranslation = async function (payload) {
  const { issue, comment, sender } = payload
  let awaitTranslation = false

  for (let i = 0; i < issue.labels.length; i += 1) {
    if (issue.labels[i].name === '翻译认领') {
      awaitTranslation = true
      break
    }
  }

  if (!awaitTranslation) return

  if (includes(comment.body, ['认领翻译', '申请翻译', '翻译认领'])) {
    try {
      await Promise.all([
        addComment(issue.number, `@${comment.user.login} 棒极啦 :tada:`),
        removeLabel(issue.number, '翻译认领'),
        addLabels(issue.number, ['正在翻译'])
      ])
    } catch(err) {
      return logger.error(err)
    }

    logger.debug(`Handle request of ${sender.login} from #${issue.number} with message ${comment.body} successfully.`)
  } else {
    logger.debug(`Can not handle request of ${sender.login} from #${issue.number} with message ${comment.body}.`)
  }
}

const handleApplyForReview = async function (payload) {
  const { issue, comment, sender } = payload

  let awaitReview = false

  for (let i = 0; i < issue.labels.length; i += 1) {
    const label = issue.labels[i]

    if (label.name === '校对认领') {
      awaitReview = true
      break
    }
  }

  if (!awaitReview) return

  if (includes(comment.body, ['认领校对', '申请校对', '校对认领'])) {
    let hasAtLeastOneReviewer = false

    for (let i = 0; i < issue.labels.length; i += 1) {
      const label = issue.labels[i]

      if (label.name === '正在校对') {
        hasAtLeastOneReviewer = true
        break
      }
    }

    try {
      logger.debug(`Trying to update PR #${issue.number} status.`)

      if (hasAtLeastOneReviewer) {
        await Promise.all([
          addComment(issue.number, `@${comment.user.login} 妥妥哒 :beers:`),
          removeLabel(issue.number, '校对认领')
        ])
      } else {
        await Promise.all([
          addComment(issue.number, `@${comment.user.login} 好的呢 :beer:`),
          addLabels(issue.number, ['正在校对'])
        ])
      }

      logger.debug(`Update PR #${issue.number} status successfully.`)
    } catch(err) {
      return logger.error(err)
    }

    const matchedIssueNumber = /#\d+/.exec(issue.body)

    if (matchedIssueNumber) {
      const issueNumber = Number(matchedIssueNumber[0].substring(1))

      if (typeof issueNumber === 'number') {
        try {
          logger.debug(`Trying to update reference issue #${issue.number} status.`)

          if (hasAtLeastOneReviewer) {
            await removeLabel(issueNumber, '请到对应的 PR 下认领校对')
          } else {
            await addLabels(issueNumber, ['正在校对'])
          }

          logger.debug(`Update reference issue #${issue.number} status successfully.`)
        } catch (err) {
          logger.error(err)
        }
      }
    }
    logger.debug(`Handle request of ${sender.login} from #${issue.number} with message ${comment.body} successfully .`)
  } else {
    logger.debug(`Can not handle request of ${sender.login} from #${issue.number} with message ${comment.body}.`)
  }
}

const handleNewPull = async function (payload) {
  const { pull_request: pull, sender } = payload

  logger.debug(`Trying to add label "校对认领" to pull ${pull.number}.`)

  await Promise.all([
    addLabels(pull.number, ['校对认领'])
  ])

  logger.debug(`Add label "校对认领" to pull ${pull.number} successfully.`)

  const matchedIssueNumber = /#\d+/.exec(pull.body)

  if (matchedIssueNumber) {
    const issueNumber = Number(matchedIssueNumber[0].substring(1))

    if (typeof issueNumber === 'number') {
      logger.debug(`Got the reference #${issueNumber} from pull #${pull.number}.`)

      try {
        logger.debug(`Trying to update issue #${issueNumber} status.`)

        await Promise.all([
          addComment(issueNumber, `PR 地址：#${pull.number}`),
          removeLabel(issueNumber, '正在翻译'),
          addLabels(issueNumber, ['请到对应的 PR 下认领校对'])
        ])

        logger.debug(`Update issue #${issueNumber} status successfully.`)
      } catch(err) {
        logger.error(err)
      }
    }
  }
}

const handleNewIssue = async (payload) => {
  const { issue, sender } = payload

  if (issue.title.includes('推荐优秀英文文章')) {
    await addComment(issue.number, `:heart: 感谢有你 ♪(*´▽｀*)ノ`)
    logger.debug(`Reply issue #${issue.number} with title ${issue.title} successfully.`)
  }
}

module.exports = async (req, res) => {
  const eventName = req.headers['x-github-event']
  let payload

  logger.info(`<-- ${req.method} ${req.url}`)

  try {
    payload = await json(req)
  } catch(err) {
    logger.error(`URL: ${req.url}, Message: ${err.message}`)
    logger.info(`--> ${req.method} ${req.url} 400`)
    return send(res, 400)
  }

  if (payload.sender.login === 'leviding') {
    logger.info(`--> payload.sender.login === leviding`)
    logger.info(`--> ${req.method} ${req.url} 200`)
    return send(res, 200)
  }

  logger.debug(`Received GitHub event ${eventName} ${payload.action} from ${payload.sender.login}`)

  if (eventName === 'issue_comment' && payload.action === 'created') {
    if (payload.issue.html_url.includes('pull')) {
      handleApplyForReview(payload)
    } else {
      handleApplyForTranslation(payload)
    }
  }

  if (eventName === 'pull_request' && payload.action === 'opened') {
    handleNewPull(payload)
  }

  if (eventName === 'issues' && payload.action === 'opened') {
    handleNewIssue(payload)
  }

  send(res, 200)

  logger.info(`--> ${req.method} ${req.url} 200`)
}
