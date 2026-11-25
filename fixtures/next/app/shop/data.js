// Server-side data with fixed delays, so each Suspense boundary waits a known time.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function getProduct(id) {
  await sleep(300)
  return {
    id,
    name: "Trail shoe",
    price: 89,
    // Big enough (over 10 KB as JSON) for the props-size hint.
    specs: Array.from({ length: 200 }, (_, i) => ({
      label: `Spec ${i}`,
      value: `A long value for spec ${i} of the trail shoe`,
    })),
  }
}

export async function getReviews() {
  await sleep(1200)
  return ["Great grip", "Runs small"]
}

export async function getRecommendations() {
  await sleep(800)
  return ["Socks", "Laces", "Insoles"]
}

export async function getCart() {
  await sleep(1500)
  return { count: 2 }
}
