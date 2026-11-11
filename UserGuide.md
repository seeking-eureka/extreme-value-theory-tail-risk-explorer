# Extreme Value Theory Tail Risk Explorer: A Plain-English Guide

## The Big Idea

Suppose your firm's worst operational loss in 10 years was $8M. The board asks: "What would a once-in-200-years loss look like?" You've never seen one, so you have to estimate it.

The usual approach fits a bell-shaped curve, such as a normal or lognormal, to every loss. The problem is that most of those losses are small. The curve ends up matching the everyday losses and guessing about the big ones.

Extreme value theory works the other way around. It looks only at the biggest losses and studies how fast they grow. This app shows how big that difference is.

## How the App Thinks

1. **Start with the loss log.** The sample firm is a mid-size investment manager. Over 10 years it logged 200 losses of $25K or more, from trade errors, pricing mistakes, settlement failures, and one $8M unauthorized trade.
2. **Pick a cutoff.** The app keeps only the losses above a cutoff, called the threshold. By default, it keeps the top 25%, which is 50 losses above $172K.
3. **Fit a tail curve.** It fits a curve called the Generalized Pareto to just those 50 losses.
4. **Read off the answers.** The app reports the 1-in-200-year loss, plus two capital measures: VaR (Value at Risk) and Expected Shortfall.

## Reading the Screen

- **Shape ξ (xi):** One number that tells you how heavy the tail is. Zero means big losses fade quickly. Above 0.5 means very heavy. At 1 or more, the average loss can't even be pinned down. The default is 0.51.
- **99.9% VaR:** The yearly total loss you'd expect to exceed only once in 1,000 years. The default is $38M.
- **Expected Shortfall:** The average of those rare worst years. The default is $74M.
- **Tail points:** How many losses the fit uses. Fewer points means less certainty.
- **The 1-in-200-Year Loss:** The tail fit says $14.9M. The lognormal says $3.4M, and the normal says $2.5M.
- **The tail chart:** Your losses are the dots. The green line is the tail fit, the purple line is the lognormal, and the blue dashed line is the normal.
- **Threshold Stability:** How each answer changes when you move the cutoff.

## A Story in Three Moments

**Moment 1: The comfortable answer.** A lognormal fitted to all 200 losses says the 1-in-200-year loss is $3.4M. It also says an $8M loss should happen about once every 6,780 years. Yet the firm had one in just 10.

**Moment 2: The tail speaks.** The tail fit uses only the 50 biggest losses. It says the 1-in-200-year loss is $14.9M, more than four times the lognormal's answer. It says the $8M loss should come about once every 61 years.

**Moment 3: Honest uncertainty.** Press Play. As the cutoff moves, the 1-in-200-year answer changes from $15M to $110M. Even at the default, the 95% range is $4.6M to $182M. The lesson isn't just "use a bigger number." It's that the tail is truly uncertain, and the range should be part of every report.

## Things to Try

- **Delete the $8M loss.** The 1-in-200-year loss drops from $14.9M to $5.4M. One event changes the whole picture.
- **Add a $5M loss found late.** Large losses sometimes come to light years after they happen. Adding one raises the 1-in-200-year loss to about $25M.
- **Set the return period to 10 years.** The models agree more closely when you ask about events inside your own history.
- **Paste your own losses.** Copy a column from a spreadsheet. Nothing leaves your browser.

## Questions to Ask Your Risk Team

- What model do we use for our largest losses, and was it fitted to the whole dataset or only the tail?
- How many losses sit in our tail, and what is the range around our 1-in-200 estimate?
- How much do our numbers change if we move the threshold?
- Have we allowed for losses that haven't been discovered yet?

## Limits to Keep in Mind

- The data is made up for teaching. It doesn't describe any real firm.
- Ten years of data from one firm is a small sample. Real programs add industry data and scenarios.
- The method assumes the business hasn't changed much over time. It ignores inflation and growth.
- This is a learning tool. It isn't a capital model and it isn't investment advice.
