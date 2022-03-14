// create a key out of a mnemonic
import {
  Coin,
  Coins,
  LCDClient,
  MnemonicKey,
  MsgExecuteContract,
  MsgInstantiateContract,
  MsgStoreCode,
} from "@terra-money/terra.js";
import * as fs from "fs";
import findFilesInDir from "./findFilesInDir.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let network = "bombay-12";
let lcdURL = "https://bombay-lcd.terra.dev";
let maker_seed =
  "uncle simple tide bundle apart absurd tenant fluid slam actor caught month hip tornado cattle regular nerve brand tower boy alert crash good neck";
let taker_seed =
  "paddle prefer true embody scissors romance train replace flush rather until clap intact hello used cricket limb cake nut permit toss stove cute easily";
let cw20_code_id = 148;

if (process.env.NETWORK === "localterra") {
  cw20_code_id = process.env.CW20ID;
  if (!cw20_code_id) {
    console.error(
      "Please deploy CW20 and pass its code to the CW20ID env var."
    );
    process.exit();
  }
  network = "localterra";
  lcdURL = "http://143.244.190.1:3060";
  maker_seed =
    "index light average senior silent limit usual local involve delay update rack cause inmate wall render magnet common feature laundry exact casual resource hundred";
  taker_seed =
    "prefer forget visit mistake mixture feel eyebrow autumn shop pair address airport diesel street pass vague innocent poem method awful require hurry unhappy shoulder";
}
let maker_key = new MnemonicKey({ mnemonic: maker_seed });
let taker_key = new MnemonicKey({ mnemonic: taker_seed });

const terra = new LCDClient({
  URL: lcdURL,
  chainID: network,
});
const maker = maker_key.accAddress;
const maker_wallet = terra.wallet(maker_key);
const taker = taker_key.accAddress;
const taker_wallet = terra.wallet(taker_key);
const min_amount = "120000000";
const max_amount = "360000000";
const maker_contact = "LunaQueen";
const offer_type = "buy";

function executeMsg(msg, wallet = maker_wallet) {
  return wallet
    .createAndSignTx({
      msgs: [msg],
    })
    .then((tx) => {
      return terra.tx.broadcast(tx);
    });
}

function instantiateFactory(codeIds) {
  //Instantiate Factory
  const factoryInstantiateMsg = {
    cw20_code_id: parseInt(cw20_code_id),
    gov_contract_code_id: codeIds.governance,
    fee_collector_code_id: codeIds.fee_collector,
    trading_incentives_code_id: codeIds.trading_incentives,
    offer_code_id: codeIds.offer,
    trade_code_id: codeIds.trade,
    fee_collector_threshold: "1000000",
    local_ust_pool_addr: maker, //TODO: use actual address
  };
  const instantiateFactoryMsg = new MsgInstantiateContract(
    maker,
    maker,
    codeIds.factory,
    factoryInstantiateMsg
  );
  return executeMsg(instantiateFactoryMsg);
}

async function create_offers(offers_addr) {
  const offers = [
    {
      create: {
        offer: {
          offer_type: "buy",
          fiat_currency: "COP",
          min_amount,
          max_amount,
          maker_contact,
        },
      },
    },
    {
      create: {
        offer: {
          offer_type: "sell",
          fiat_currency: "BRL",
          min_amount,
          max_amount,
          maker_contact,
        },
      },
    },
    {
      create: {
        offer: {
          offer_type: "buy",
          fiat_currency: "USD",
          min_amount,
          max_amount,
          maker_contact,
        },
      },
    },
  ];

  let finalResult;

  for (let idx = 0; idx < offers.length; idx++) {
    const offer = offers[idx];

    let createOfferMsg = new MsgExecuteContract(maker, offers_addr, offer);

    console.log(`*Creating Offer ${idx}*`);

    const result = await executeMsg(createOfferMsg);
    console.log(`Created Offer ${idx}:`, result);
    finalResult = result;
  }
  return finalResult;
}

async function query_offers(offers_addr) {
  const queries = [
    {
      offers_query: {
        limit: 5,
        last_value: 0,
      },
    },
    {
      offers_query: {
        limit: 2,
        last_value: 1,
        owner: "terra1333veey879eeqcff8j3gfcgwt8cfrg9mq20v6f",
      },
    },
  ];

  for (let idx = 0; idx < queries.length; idx++) {
    const query = queries[idx];

    console.log(`*Querying Offer Contract, Query #${idx}*`, query);

    const result = await terra.wasm.contractQuery(offers_addr, query);

    console.log(`Offer Query #${idx} Result:`, result);
  }
}

async function test(codeIds) {
  let factoryCfg;
  let factoryAddr = process.env.FACTORY;
  let tradeAddr;

  let setup = new Promise((resolve, reject) => {
    if (factoryAddr) {
      console.log("*Querying Factory Config*");
      terra.wasm.contractQuery(factoryAddr, { config: {} }).then((r) => {
        resolve(r);
      });
    } else {
      console.log("*Instantiating Factory*");
      instantiateFactory(codeIds).then((r) => {
        const factoryAddr = getAttribute(
          r,
          "instantiate_contract",
          "contract_address"
        );
        console.log("**Factory Addr:", factoryAddr);
        console.log("*Querying Factory Config*");
        terra.wasm.contractQuery(factoryAddr, { config: {} }).then((r) => {
          resolve(r);
        });
      });
    }
  });
  setup
    .then(async (r) => {
      factoryCfg = r;
      console.log("Factory Config result", r);

      const createOfferResult = await create_offers(factoryCfg.offers_addr);
      await query_offers(factoryCfg.offers_addr);

      return createOfferResult;
    })
    .then((r) => {
      console.log("*Creating Offer for Trade*");
      const newOffer = {
        create: {
          offer: {
            offer_type,
            fiat_currency: "BRL",
            min_amount,
            max_amount,
            maker_contact,
          },
        },
      };
      let createOfferMsg = new MsgExecuteContract(
        maker,
        factoryCfg.offers_addr,
        newOffer
      );
      return executeMsg(createOfferMsg);
    })
    .then((r) => {
      let offerId = getAttribute(r, "from_contract", "id");
      let createTradeMsg = new MsgExecuteContract(
        maker,
        factoryCfg.offers_addr,
        {
          new_trade: {
            offer_id: parseInt(offerId),
            ust_amount: min_amount + "",
            taker: maker,
            taker_contact: "USTKing",
            arbitrator: maker,
          },
        }
      );
      console.log("*Creating Trade*");
      return executeMsg(createTradeMsg);
    })
    .then((result) => {
      tradeAddr = result.logs[0].events
        .find((e) => e.type === "instantiate_contract")
        .attributes.find((a) => a.key === "contract_address").value;
      console.log("**Trade created with address:", tradeAddr);
      console.log(`https://finder.terra.money/${network}/address/${tradeAddr}`);
      //Send UST and fund trade
      const coin = Coin.fromData({
        denom: "uusd",
        amount: min_amount * 2 + "",
      });
      const coins = new Coins([coin]);
      let fundEscrowMsg = new MsgExecuteContract(
        taker,
        tradeAddr,
        { fund_escrow: {} },
        coins
      );
      console.log("*Funding Escrow*");
      return executeMsg(fundEscrowMsg, taker_wallet);
    })
    .then((r) => {
      if (r.txhash) {
        console.log("**Escrow Funded**");
      } else {
        console.log("%Error%");
      }
      const releaseMsg = new MsgExecuteContract(taker, tradeAddr, {
        release: {},
      });
      console.log("*Releasing Trade*");
      return executeMsg(releaseMsg, taker_wallet);
    })
    .then((r) => {
      console.log("**Trade Released**");
    });
}

function createStoreMsg(contract) {
  console.log(`*Storing ${contract}*`);
  const wasm = fs.readFileSync(contract, {
    highWaterMark: 16,
    encoding: "base64",
  });
  return new MsgStoreCode(maker, wasm);
}

function getContractNameFromPath(path) {
  let regex = RegExp(/artifacts\/(.*?)\.wasm/, "i");
  return path.match(regex)[1];
}

function getCodeIdFromResult(result) {
  return parseInt(getAttribute(result, "store_code", "code_id"));
}

function getAttribute(result, event, attribute) {
  console.log('maker', maker)
  console.log('result', result)
  console.log('event', event)
  console.log('attribute', attribute)

  return result.logs[0].events
    .find((e) => e.type === event)
    .attributes.find((e) => e.key === attribute).value;
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deploy(contract) {
  let codeIds = {};
  let contracts = findFilesInDir(process.env.CONTRACTS, ".wasm");

  if (contract.toLowerCase() === "all") {
    for (const i in contracts) {
      let c = contracts[i];
      let r = await executeMsg(createStoreMsg(c));
      //TODO: remove hack
      console.log("waiting");
      await timeout(1000);
      console.log("continue");
      codeIds[getContractNameFromPath(c)] = getCodeIdFromResult(r);
    }
    fs.writeFileSync("codeIds.json", JSON.stringify(codeIds), "utf8");
    console.log("Deploy Finished!", JSON.stringify(codeIds));
    await test(codeIds);
  } else {
    //Filter by name
    let codeIds = JSON.parse(fs.readFileSync("codeIds.json", "utf8"));
    console.log(codeIds);
    let names;
    if (contract.indexOf(",")) {
      names = contract.split(",");
    } else {
      names = [contract];
    }
    for (const i in names) {
      let name = names[i];
      for (const i in contracts) {
        let c = contracts[i];
        if (c.indexOf(name) >= 0) {
          let r = await executeMsg(createStoreMsg(c));
          codeIds[getContractNameFromPath(c)] = getCodeIdFromResult(r);
        }
      }
    }
    console.log("Deploy Finished!", JSON.stringify(codeIds));
    await test(codeIds);
  }
}

function fundEscrow(tradeAddr) {
  const coin = Coin.fromData({
    denom: "uusd",
    amount: min_amount + "",
  });
  const coins = new Coins([coin]);
  let fundEscrowMsg = new MsgExecuteContract(
    taker,
    tradeAddr,
    { fund_escrow: {} },
    coins
  );
  console.log("*Funding Escrow*");
  executeMsg(fundEscrowMsg, taker_wallet).then((r) => {
    console.log("Result", r);
    if (r.txhash) {
      release(tradeAddr, taker_wallet);
    }
  });
}

function release(tradeAddr, wallet) {
  console.log("Sending release msg");
  const releaseMsg = new MsgExecuteContract(taker, tradeAddr, {
    release: {},
  });
  console.log("Release Msg:", releaseMsg);
  executeMsg(releaseMsg, wallet).then((r) => {
    r.toJSON().then((r) => console.log(r));
  });
}

if (process.env.DEPLOY) {
  await deploy(process.env.DEPLOY);
} else if (process.env.FUND) {
  fundEscrow(process.env.FUND);
} else if (process.env.RELEASE) {
  release(process.env.RELEASE, taker_wallet);
} else {
  let codeIds = JSON.parse(fs.readFileSync("codeIds.json", "utf8"));
  await test(codeIds);
}

// await create_offers("terra19qlfxw9sps07pxnqa5ecw73nyjqmsktut9tlhj");
// await query_offers("terra19qlfxw9sps07pxnqa5ecw73nyjqmsktut9tlhj");
