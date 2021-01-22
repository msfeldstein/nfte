import { ethers, BigNumber, utils } from "ethers"
import { fromUnixTime, format } from "date-fns"
import get from "lodash/get"
import erc721ABI from "@utils/erc721ABI"
import platforms from "@utils/platforms"
import isIPFS from "@utils/isIPFS"
import makeIPFSUrl from "@utils/makeIPFSUrl"

export default async function ({ contract, tokenId }) {
  const provider = new ethers.providers.CloudflareProvider()
  const historicalProvider = new ethers.providers.InfuraProvider(
    null,
    process.env.INFURA_PROJECT_ID
  )

  const isValidAddress = utils.isAddress(contract)

  if (!isValidAddress) throw Error("not a valid address")

  const erc721 = new ethers.Contract(contract, erc721ABI, provider)
  const erc721Historical = new ethers.Contract(
    contract,
    erc721ABI,
    historicalProvider
  )

  try {
    const symbolProm = erc721.symbol()
    const tokenURIProm = erc721.tokenURI(tokenId)
    const ownerOfProm = erc721.ownerOf(tokenId)
    const eventProm = erc721Historical.filters.Transfer(
      ethers.constants.AddressZero,
      null,
      BigNumber.from(tokenId)
    )
    const promises = await Promise.allSettled([
      symbolProm,
      tokenURIProm,
      ownerOfProm,
      eventProm,
    ])

    const [symbol, tokenURI, ownerOf, event] = promises

    const ownerEns = await provider.lookupAddress(ownerOf.value)
    const logs = await erc721Historical.queryFilter(event.value, 0)
    const creatorOf = logs[0].args.to
    const creatorEns = await provider.lookupAddress(creatorOf)
    const blockNumber = logs[0].blockNumber
    const timestamp = (await logs[0].getBlock()).timestamp

    const resolvedTokenURI = isIPFS(tokenURI.value)
      ? makeIPFSUrl(tokenURI.value)
      : tokenURI.value

    const r = await fetch(resolvedTokenURI)
    const metadata = await r.json()

    const platform = platforms.filter((p) =>
      p.addresses.map(utils.getAddress).includes(utils.getAddress(contract))
    )[0]

    const mediaUrl = get(metadata, platform?.mediaPath, null) ?? metadata.image

    const resolvedMediaUrl = isIPFS(mediaUrl) ? makeIPFSUrl(mediaUrl) : mediaUrl

    return {
      contract,
      tokenId,
      metadata,
      ownerOf: { address: ownerOf.value, ensName: ownerEns },
      creatorOf: {
        address: creatorOf,
        ensName: creatorEns,
        name: get(metadata, platform?.creatorNamePath, null),
      },
      symbol: symbol.value,
      media: resolvedMediaUrl,
      blockNumber,
      timestamp: format(fromUnixTime(timestamp), "dd/MM/yyyy HH:mm"),
      platform,
    }
  } catch (e) {
    console.log(e)
    throw Error("tokenId does not exist")
  }
}