let activeEffect;
const effectStack = [];

const bucket = new WeakMap();

// const data = { ok: true, text: 'hello world' };
// const data = { foo: true, bar: true };
const data = { foo: 1, bar: 2 };

const obj = new Proxy(data, {
  get(target, key) {
    track(target, key);
    return target[key];
  },
  set(target, key, newVal) {
    target[key] = newVal;
    trigger(target, key);
  },
});

function track(target, key) {
  if (!activeEffect) return;
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  activeEffect.deps.push(deps);
}

function trigger(target, key) {
  const depMaps = bucket.get(target);
  if (!depMaps) return;
  const effects = depMaps.get(key);

  // 防止副作用函数无限执行
  // 调用副作用函数时会先调用cleanup清除该副作用函数，但副作用函数的执行会使它被重新收集到依赖中。
  // effectsToRun没执行一个副作用函数，就把它从原依赖集合中删除，不会影响effectsToRun的遍历
  const effectsToRun = new Set();
  effects &&
    effects.forEach((effectFn) => {
      // 如果触发的副作用函数与当前正在执行的副作用函数相同，则不执行
      if (effectFn !== activeEffect) {
        effectsToRun.add(effectFn);
      }
    });
  effectsToRun.forEach((effectFn) => {
    // 如果有调度器，就调用调度器，并把副作用函数传给调度器
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn);
    } else {
      // 没有调度器就直接执行副作用函数
      effectFn();
    }
  });
}

const jobQueue = new Set();
const p = Promise.resolve();

let isFlushing = false;
//
function flushJob() {
  // 如果队列正在刷新，则什么也不做
  if (isFlushing) return;
  isFlushing = true;
  // 在微任务队列中刷新jobQueue
  // 用于不管中间状态，只更新最终状态
  p.then(() => {
    jobQueue.forEach((job) => job());
  }).finally(() => {
    // 结束后重置isFlushing
    isFlushing = false;
    // jobQueue.clear(); // 应该清空队列？？
  });
}

// 注册副作用函数
function effect(fn, options = {}) {
  const effectFn = () => {
    // 副作用函数执行时，先把它从与之关联的依赖集合中删除，副作用函数执行后重新建立联系，防止副作用函数遗留（分支切换）
    cleanup(effectFn);
    // 处理副作用函数嵌套的情况
    activeEffect = effectFn;
    effectStack.push(effectFn);
    const res = fn();
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    // 将res作为effectFn的返回值
    return res;
  };
  effectFn.options = options;
  // 用来存储所有与该副作用函数相关的依赖集合
  effectFn.deps = [];
  // 非lazy时才立刻执行
  if (!options.lazy) {
    effectFn();
  }
  // 将副作用函数作为返回值返回（computed）
  return effectFn;
}

function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i];
    deps.delete(effectFn);
  }
  effectFn.deps.length = [];
}

function computed(getter) {
  let value,
    // 标识是否需要重新计算值
    dirty = true;
  const getterFn = effect(getter, {
    lazy: true,
    scheduler() {
      // 在调度器中重置dirty值为true
      dirty = true;
      // 计算属性以来的响应式数据变化是，手动调用trigger
      trigger(obj, "value");
    },
  });
  const obj = {
    // 读取value的值时才执行effectFn
    get value() {
      if (dirty) {
        value = getterFn();
        // 将dirty设置为false，下一次访问直接使用缓存到value中的值
        dirty = false;
      }
      // 读取value时，手动调用track进行追踪
      track(obj, "value");
      return value;
    },
  };
  return obj;
}

function watch(source, cb, options = {}) {
  let getter;
  // 如果source是函数，说明用户传递的是getter，直接把source赋值给getter
  if (typeof source === "function") {
    getter = source;
  } else {
    // 否则调用traverse递归读取
    getter = () => traverse(source);
  }
  let oldValue, newValue;
  // cleanup用来存储用户注册的过期回调
  let cleanup;
  // 定义onInvalidate函数
  function onInvalidate(fn) {
    cleanup = fn;
  }
  // 提取scheduler调度函数为一个独立的job函数
  const job = () => {
    // 在scheduler中重新执行副作用函数，得到的是新值
    newValue = effectFn();
    // 在调用回调函数cb前，先调用过期回调
    if (cleanup) {
      cleanup();
    }
    // 将旧值和新值传递给回调函数，onInvalidate作为回调的第三个参数
    cb(oldValue, newValue, onInvalidate);
    // 更新旧值
    oldValue = newValue;
  };

  // 使用effect注册副作用函数时，开启lazy选项
  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      // 根据flush判断调度执行的方式
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(job);
      } else {
        job();
      }
    },
  });
  if (options.immediate) {
    // 当immediate为true时，立即执行job，从而触发回调执行
    job();
  } else {
    oldValue = effectFn();
  }
}

// 递归读取对象的所有属性
function traverse(value, seen = new Set()) {
  // 如果要读取的是原始值，或者已经被读取过了，那么什么也不做
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  // 将数据添加到seen中，代表遍历地读取过了，避免循环引用引起的死循环
  seen.add(value);
  // 暂不考虑数组等其他结构...
  for (const k in value) {
    traverse(value[k], seen);
  }
  return value;
}

window.onload = () => {
  // effect(() => {
  //   console.log('effect run');
  //   document.body.innerHTML = obj.ok ?  obj.text : 'not';
  // });
  /* let temp1, temp2;
  effect(function effectFn1() {
    console.log('effectFn1 执行');

    effect(function effectFn2() {
      console.log('effectFn2 执行');
      temp2 = obj.bar;
    });
    temp1 = obj.foo;
  }); */

  /* effect(() => {
    console.log(obj.foo);
  }, {
    scheduler(fn) {
      setTimeout(fn);
    }
  });
  obj.foo++;
  console.log('结束了'); */

  /* effect(() => {
    console.log(obj.foo);
  }, {
    scheduler(fn) {
      // 每次调度时，将副作用函数添加到jobQueue队列中
      jobQueue.add(fn);
      // 刷新队列
      flushJob();
    }
  });
  obj.foo++;
  obj.foo++; */

  /* const effectFn = effect(() => {
    console.log(obj.foo);
  }, {
    lazy: true
  });
  effectFn(); */

  /* const sumRes = computed(() => obj.foo + obj.bar);
  effect(() => {
    console.log(sumRes.value);
  });
  obj.foo++; */
  watch(
    () => obj.foo,
    (oldVal, newVal) => {
      console.log("数据变化了", oldVal, newVal);
    }
  );
  obj.foo++;
};

// setTimeout(() => {
//   obj.ok = false;
// }, 1000);

// setTimeout(() => {
//   obj.text = 'hello vue3';
// }, 2000);

/* setTimeout(() => {
  obj.foo = false;
}, 1000); */
