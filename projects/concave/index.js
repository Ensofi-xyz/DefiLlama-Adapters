const sdk = require('@defillama/sdk')
const BigNumber = require("bignumber.js");
const { ohmTvl } = require('../helper/ohm')
const abi = require('./abi.json')

// Treasury backing the CNV price, similar to OHM so using the ohm wrapper
const treasury = '0x226e7af139a0f34c6771deb252f9988876ac1ced' 
const etherAddress = '0x0000000000000000000000000000000000000000'
const cnv_token = '0xdea1fc87b6f4536e852aea73aeb8f4ac0cf843c3'
const stakingAddress = '0x0000000000000000000000000000000000000000'
const treasuryTokens = [
    ['0x6b175474e89094c44da98b954eedeac495271d0f', false], //DAI
    ['0x0ab87046fBb341D058F17CBC4c1133F25a20a52f', false], //gOHM
]

// CVX treasury position parameters
const cvxUST_whv23CRV_BaseRewardPool = '0x7e2b9b5244bcfa5108a76d5e7b507cfd5581ad4a'
const cvxUST_whv23CRV_f = '0x2d2006135e682984a8a2eb74f5c87c2251cc71e9' // CVX LP, base reward pool holds 100% of that token plus some crv. Can be queried via stakingToken method on baseRewardPool
const UST_whv23CRV_f = '0xceaf7747579696a2f0bb206a14210e3c9e6fb269' // Crv LP, Best would be to derive it from the baseRewardPool or cvx contract


// Generic CRV position unwrapping, useful for a CVX position unwrapping
const abi_crvLP_coins = {'stateMutability':'view','type':'function','name':'coins','inputs':[{'name':'arg0','type':'uint256'}],'outputs':[{'name':'','type':'address'}],'gas':3123}
async function genericUnwrapCrv(balances, crvToken, lpBalance, block, chain) {
  const {output: resolvedCrvTotalSupply} = await sdk.api.erc20.totalSupply({
    target: crvToken,
    chain, block })

  // Get Curve LP token balances
  // A while-loop would need a try-catch because sending error when idx > tokens_count
  const {output: crv_symbol} = await sdk.api.abi.call({
    abi: 'erc20:symbol', 
    target: crvToken,
    chain,
    block
  })
  const LP_tokens_count = 1 + (crv_symbol.match(/_/g) || []).length
  const coins_indices = Array.from(Array(LP_tokens_count).keys())
  const coins = (await sdk.api.abi.multiCall({
    abi: abi_crvLP_coins, 
    calls: coins_indices.map(i => ({params: [i]})),
    target: crvToken,
    chain,
    block
  })).output.map(c => c.output)
  const crvLP_token_balances = await sdk.api.abi.multiCall({
    abi: 'erc20:balanceOf', 
    calls: coins.map(c => ({
      target: c,
      params: crvToken,
    })),
    chain,
    block
  })

  // Edit the balances to weigh with respect to the wallet holdings of the crv LP token
  crvLP_token_balances.output.forEach(call => 
    call.output = BigNumber(call.output).times(lpBalance).div(resolvedCrvTotalSupply).toFixed(0)
  )
  sdk.util.sumMultiBalanceOf(balances, crvLP_token_balances);
}

async function tvl(timestamp, ethBlock, chainBlocks) {
  // Get ether balance
  const balances = {
    [etherAddress]: (await sdk.api.eth.getBalance({ target: treasury, ethBlock })).output
  }

  // Compute the balance of the treasury of the CVX position and unwrap
  const chain = 'ethereum'
  const {output: cvx_LP_bal} = await sdk.api.abi.call({
    abi: abi['cvx_balanceOf'], // cvx_balanceOf cvx_earned cvx_rewards cvx_userRewardPerTokenPaid
    target: cvxUST_whv23CRV_BaseRewardPool,
    params: [treasury],
    chain,
    block: ethBlock,
  })
  await genericUnwrapCrv(balances, UST_whv23CRV_f, cvx_LP_bal, ethBlock, chain)
  
  return balances
}


module.exports = ohmTvl(treasury, treasuryTokens, 'ethereum', stakingAddress, cnv_token, undefined, undefined, true)
module.exports.ethereum.tvl = sdk.util.sumChainTvls([tvl, module.exports.ethereum.tvl])
module.exports.methodology = 'Count the treasury assets (cvx position, ohm etc) baackin the CNV price'